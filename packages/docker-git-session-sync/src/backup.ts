import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import {
  buildBlobUrl,
  buildCommentBody,
  buildManifest,
  buildSnapshotReadme,
  buildSnapshotRef,
  formatBytes,
  isPathWithinParent,
  isChatTranscriptPath,
  sessionDirNames,
  sessionWalkIgnoreDirNames,
  shouldIgnoreSessionPath,
  sortSessionFiles,
  summarizeFiles,
  toLogicalRelativePath
} from "./core.js"
import { ensureBackupRepo, prepareUploadArtifacts, resolveGhEnvironment, runGitCapture, uploadSnapshot } from "./shell.js"
import type { GhEnv, Log, SessionFile } from "./types.js"

export interface BackupOptions {
  readonly sessionDir: string | null
  readonly prNumber: number | null
  readonly repo: string | null
  readonly postComment: boolean
  readonly dryRun: boolean
  readonly verbose: boolean
}

export interface Output {
  readonly out: Log
  readonly err: Log
}

const logVerbose = (verbose: boolean, output: Output, message: string): void => {
  if (verbose) {
    output.out(`[session-backup] ${message}`)
  }
}

const getGitStatus = (cwd: string): string | null => {
  const status = runGitCapture(cwd, ["status"])
  if (status === null) {
    return null
  }
  return status.length === 0 ? "clean" : status
}

const printGitStatus = (output: Output, status: string | null): void => {
  output.out("[session-backup] git status:")
  if (status === null) {
    output.out("[session-backup] (unavailable)")
    return
  }
  for (const line of status.split("\n")) {
    output.out(`[session-backup] ${line}`)
  }
}

const parseGitHubRepoFromRemoteUrl = (remoteUrl: string): string | null => {
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+\/[^.]+)(?:\.git)?$/u)
  if (sshMatch?.[1] !== undefined) {
    return sshMatch[1]
  }
  const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/([^/]+\/[^.]+)(?:\.git)?$/u)
  if (httpsMatch?.[1] !== undefined) {
    return httpsMatch[1]
  }
  return null
}

const rankRemoteName = (remoteName: string): number => {
  if (remoteName === "upstream") {
    return 0
  }
  if (remoteName === "origin") {
    return 1
  }
  return 2
}

const getRepoCandidates = (cwd: string, explicitRepo: string | null, verbose: boolean, output: Output): ReadonlyArray<string> => {
  if (explicitRepo !== null) {
    return [explicitRepo]
  }
  const remoteOutput = runGitCapture(cwd, ["remote", "-v"])
  if (remoteOutput === null) {
    return []
  }
  const remotes: Array<{ readonly remoteName: string; readonly repo: string }> = []
  const seenRepos = new Set<string>()
  for (const line of remoteOutput.split("\n")) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/u)
    if (match?.[1] === undefined || match[2] === undefined || match[3] !== "fetch") {
      continue
    }
    const repo = parseGitHubRepoFromRemoteUrl(match[2])
    if (repo === null || seenRepos.has(repo)) {
      continue
    }
    remotes.push({ remoteName: match[1], repo })
    seenRepos.add(repo)
  }
  remotes.sort((left, right) => {
    const rankDiff = rankRemoteName(left.remoteName) - rankRemoteName(right.remoteName)
    return rankDiff !== 0 ? rankDiff : left.remoteName.localeCompare(right.remoteName)
  })
  const repos = remotes.map(({ repo }) => repo)
  if (repos.length > 0) {
    logVerbose(verbose, output, `Repository candidates: ${repos.join(", ")}`)
  }
  return repos
}

const ghPrCommand = (args: ReadonlyArray<string>, ghEnv: GhEnv): { readonly success: boolean; readonly stdout: string } => {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: ghEnv
  })
  return {
    success: result.status === 0,
    stdout: (result.stdout ?? "").trim()
  }
}

const getPrNumberFromBranch = (repo: string, branch: string, ghEnv: GhEnv): number | null => {
  const result = ghPrCommand([
    "pr",
    "list",
    "--repo",
    repo,
    "--head",
    branch,
    "--json",
    "number",
    "--jq",
    ".[0].number"
  ], ghEnv)
  const parsed = Number.parseInt(result.stdout, 10)
  return result.success && !Number.isNaN(parsed) ? parsed : null
}

const getPrState = (repo: string, prNumber: number, ghEnv: GhEnv): string | null => {
  const result = ghPrCommand([
    "pr",
    "view",
    prNumber.toString(),
    "--repo",
    repo,
    "--json",
    "state",
    "--jq",
    ".state"
  ], ghEnv)
  return result.success ? result.stdout : null
}

const prIsOpen = (repo: string, prNumber: number, ghEnv: GhEnv): boolean =>
  getPrState(repo, prNumber, ghEnv) === "OPEN"

const getPrNumberFromWorkspaceBranch = (branch: string): number | null => {
  const match = branch.match(/^pr-refs-pull-([0-9]+)-head$/u)
  if (match?.[1] === undefined) {
    return null
  }
  const prNumber = Number.parseInt(match[1], 10)
  return Number.isNaN(prNumber) ? null : prNumber
}

const findPrContext = (
  repos: ReadonlyArray<string>,
  branch: string,
  verbose: boolean,
  output: Output,
  ghEnv: GhEnv
): { readonly repo: string; readonly prNumber: number } | null => {
  for (const repo of repos) {
    logVerbose(verbose, output, `Checking open PR in ${repo} for branch ${branch}`)
    const prNumber = getPrNumberFromBranch(repo, branch, ghEnv)
    if (prNumber !== null && prIsOpen(repo, prNumber, ghEnv)) {
      return { repo, prNumber }
    }
    if (prNumber !== null) {
      logVerbose(verbose, output, `Skipping PR #${prNumber} in ${repo}: PR is not open`)
    }
  }

  const workspacePrNumber = getPrNumberFromWorkspaceBranch(branch)
  if (workspacePrNumber === null) {
    return null
  }
  for (const repo of repos) {
    logVerbose(verbose, output, `Checking workspace PR #${workspacePrNumber} in ${repo} for branch ${branch}`)
    if (prIsOpen(repo, workspacePrNumber, ghEnv)) {
      return { repo, prNumber: workspacePrNumber }
    }
  }
  return null
}

type SessionDir = { readonly name: string; readonly path: string }

const allowedSessionRootDescription = sessionDirNames.map((dirName) => `~/${dirName}`).join(" or ")

const getAllowedSessionRoots = (): ReadonlyArray<SessionDir> => {
  const homeDir = os.homedir()
  return sessionDirNames
    .map((dirName) => ({ name: dirName, path: path.join(homeDir, dirName) }))
    .filter((entry) => fs.existsSync(entry.path))
}

const resolveAllowedSessionDir = (
  candidatePath: string,
  verbose: boolean,
  output: Output
): SessionDir | null => {
  const resolvedPath = path.resolve(candidatePath)
  if (!fs.existsSync(resolvedPath)) {
    return null
  }
  const stats = fs.statSync(resolvedPath)
  if (!stats.isDirectory()) {
    return null
  }
  for (const root of getAllowedSessionRoots()) {
    if (isPathWithinParent(resolvedPath, root.path)) {
      const relativePath = toLogicalRelativePath(path.relative(root.path, resolvedPath))
      return {
        name: relativePath.length === 0 ? root.name : path.posix.join(root.name, relativePath),
        path: resolvedPath
      }
    }
  }
  logVerbose(verbose, output, `Skipping non-session directory: ${candidatePath}`)
  return null
}

const findSessionDirs = (
  explicitPath: string | null,
  verbose: boolean,
  output: Output
): ReadonlyArray<SessionDir> => {
  if (explicitPath !== null) {
    const allowedDir = resolveAllowedSessionDir(path.resolve(explicitPath), verbose, output)
    if (allowedDir === null) {
      throw new Error(`--session-dir must point to a directory under ${allowedSessionRootDescription}`)
    }
    return [allowedDir]
  }

  const dirs: Array<SessionDir> = []
  for (const root of getAllowedSessionRoots()) {
    const allowedDir = resolveAllowedSessionDir(root.path, verbose, output)
    if (allowedDir !== null) {
      logVerbose(verbose, output, `Found session directory: ${allowedDir.path}`)
      dirs.push(allowedDir)
    }
  }
  return dirs
}

export const collectSessionFiles = (dirPath: string, baseName: string, verbose: boolean, output: Output): ReadonlyArray<SessionFile> => {
  const files: Array<SessionFile> = []
  const walk = (currentPath: string, relativePath: string): void => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      const relPath = relativePath.length > 0 ? `${relativePath}/${entry.name}` : entry.name
      const logicalRelPath = toLogicalRelativePath(relPath)
      if (shouldIgnoreSessionPath(logicalRelPath)) {
        logVerbose(verbose, output, `Skipping tmp path: ${path.posix.join(baseName, logicalRelPath)}`)
        continue
      }
      if (entry.isDirectory()) {
        if (!sessionWalkIgnoreDirNames.has(entry.name)) {
          walk(fullPath, relPath)
        }
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      try {
        const stats = fs.statSync(fullPath)
        const logicalName = path.posix.join(baseName, logicalRelPath)
        if (!isChatTranscriptPath(logicalName)) {
          logVerbose(verbose, output, `Skipping non-chat file: ${logicalName}`)
          continue
        }
        files.push({ logicalName, sourcePath: fullPath, size: stats.size })
        logVerbose(verbose, output, `Collected file: ${logicalName} (${stats.size} bytes)`)
      } catch (error) {
        logVerbose(verbose, output, `Error reading file ${fullPath}: ${String(error)}`)
      }
    }
  }
  walk(dirPath, "")
  return sortSessionFiles(files)
}

const postPrComment = (
  repo: string,
  prNumber: number,
  comment: string,
  verbose: boolean,
  output: Output,
  ghEnv: GhEnv
): boolean => {
  logVerbose(verbose, output, `Posting comment to PR #${prNumber}`)
  const result = ghPrCommand(["pr", "comment", prNumber.toString(), "--repo", repo, "--body", comment], ghEnv)
  if (!result.success) {
    output.err("[session-backup] Failed to post PR comment")
    return false
  }
  logVerbose(verbose, output, "Comment posted successfully")
  return true
}

export const backupSessions = (options: BackupOptions, cwd: string, output: Output): number => {
  if (process.env["DOCKER_GIT_SKIP_SESSION_BACKUP"] === "1") {
    output.out("[session-backup] Skipped (DOCKER_GIT_SKIP_SESSION_BACKUP=1)")
    return 0
  }

  const verbose = options.verbose
  const ghEnv = resolveGhEnvironment(cwd, (message) => logVerbose(verbose, output, message))
  logVerbose(verbose, output, "Starting session backup...")

  const repoCandidates = getRepoCandidates(cwd, options.repo, verbose, output)
  if (repoCandidates.length === 0) {
    output.err("[session-backup] Could not determine source repository. Use --repo option.")
    return 1
  }
  const sourceRepo = repoCandidates[0]
  if (sourceRepo === undefined) {
    return 1
  }
  logVerbose(verbose, output, `Repository: ${sourceRepo}`)

  const branch = runGitCapture(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch === null || branch.length === 0) {
    output.err("[session-backup] Could not determine current branch.")
    return 1
  }
  logVerbose(verbose, output, `Branch: ${branch}`)

  const commitSha = runGitCapture(cwd, ["rev-parse", "HEAD"])
  if (commitSha === null || commitSha.length === 0) {
    output.err("[session-backup] Could not determine current commit.")
    return 1
  }

  let prContext: { readonly repo: string; readonly prNumber: number } | null = null
  if (options.prNumber !== null) {
    if (prIsOpen(sourceRepo, options.prNumber, ghEnv)) {
      prContext = { repo: sourceRepo, prNumber: options.prNumber }
    } else {
      logVerbose(verbose, output, `Skipping PR comment: PR #${options.prNumber} is not open`)
    }
  } else if (options.postComment) {
    prContext = findPrContext(repoCandidates, branch, verbose, output, ghEnv)
  }

  if (prContext !== null) {
    logVerbose(verbose, output, `PR number: ${prContext.prNumber} (${prContext.repo})`)
  } else if (options.postComment) {
    logVerbose(verbose, output, "No PR found for current branch, skipping comment")
  }

  const sessionDirs = findSessionDirs(options.sessionDir, verbose, output)
  if (sessionDirs.length === 0) {
    logVerbose(verbose, output, "No session directories found")
    return 0
  }

  const sessionFiles = sessionDirs.flatMap((dir) => collectSessionFiles(dir.path, dir.name, verbose, output))
  logVerbose(verbose, output, `Total files to backup: ${sessionFiles.length}`)

  const backupRepo = ensureBackupRepo(ghEnv, (message) => logVerbose(verbose, output, message), !options.dryRun)
  if (backupRepo === null) {
    output.err("[session-backup] Failed to resolve or create the private session backup repository")
    return 1
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-repo-"))
  try {
    const snapshotCreatedAt = new Date().toISOString()
    const snapshotRef = buildSnapshotRef(sourceRepo, prContext?.prNumber ?? null, branch)
    const prepared = prepareUploadArtifacts(
      sessionFiles,
      snapshotRef,
      backupRepo.fullName,
      backupRepo.defaultBranch,
      tmpDir,
      (message) => logVerbose(verbose, output, message)
    )
    const source = {
      repo: sourceRepo,
      branch,
      prNumber: prContext?.prNumber ?? null,
      commitSha,
      createdAt: snapshotCreatedAt
    }
    const summary = summarizeFiles(prepared.manifestFiles)
    const sessionRoots = sessionDirs.map((dir) => `~/${dir.name}`)
    const manifestUrl = buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, `${snapshotRef}/manifest.json`)
    const readmeRepoPath = `${snapshotRef}/README.md`
    const readmeUrl = buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, readmeRepoPath)
    const gitStatus = getGitStatus(cwd)
    const manifest = buildManifest({
      backupRepo,
      snapshotRef,
      source,
      files: prepared.manifestFiles,
      createdAt: snapshotCreatedAt
    })
    const readmePath = path.join(tmpDir, "README.md")
    fs.writeFileSync(
      readmePath,
      buildSnapshotReadme({ backupRepo, source, manifestUrl, summary, sessionRoots }),
      "utf8"
    )
    const uploadEntries = [
      ...prepared.uploadEntries,
      {
        repoPath: readmeRepoPath,
        sourcePath: readmePath,
        type: "readme",
        size: fs.statSync(readmePath).size
      }
    ]
    if (options.dryRun) {
      output.out(`[session-backup] dry-run: ${source.commitSha.slice(0, 12)} (${summary.fileCount} files, ${formatBytes(summary.totalBytes)})`)
      printGitStatus(output, gitStatus)
      logVerbose(verbose, output, `[dry-run] Upload target: ${backupRepo.fullName}:${snapshotRef}`)
      logVerbose(verbose, output, `[dry-run] README URL: ${readmeUrl}`)
      logVerbose(verbose, output, `[dry-run] Manifest URL: ${manifestUrl}`)
      if (options.postComment && prContext !== null) {
        logVerbose(verbose, output, `Would post comment to PR #${prContext.prNumber} in ${prContext.repo}:`)
        logVerbose(verbose, output, buildCommentBody({ source, manifestUrl, readmeUrl, summary, gitStatus }))
      }
      return 0
    }

    logVerbose(verbose, output, `Uploading snapshot to ${backupRepo.fullName}:${snapshotRef}`)
    const uploadResult = uploadSnapshot(backupRepo, snapshotRef, manifest, uploadEntries, ghEnv)
    output.out(`[session-backup] ok: ${source.commitSha.slice(0, 12)} (${summary.fileCount} files, ${formatBytes(summary.totalBytes)})`)
    printGitStatus(output, gitStatus)
    logVerbose(verbose, output, `[session-backup] Uploaded snapshot to ${backupRepo.fullName}:${snapshotRef}`)
    logVerbose(verbose, output, `[session-backup] Manifest: ${uploadResult.manifestUrl}`)

    if (options.postComment && prContext !== null) {
      postPrComment(
        prContext.repo,
        prContext.prNumber,
        buildCommentBody({ source, manifestUrl: uploadResult.manifestUrl, readmeUrl, summary, gitStatus }),
        verbose,
        output,
        ghEnv
      )
    }
    return 0
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
