import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"

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
import {
  createPrComment,
  ensureBackupRepo,
  gitBlobShaForFile,
  prepareUploadArtifacts,
  resolveGhEnvironment,
  runGitCapture,
  updatePrComment,
  uploadSnapshot
} from "./shell.js"
import { errorMessage, isRecord, numberField, recordField, stringField } from "./json.js"
import type { GhEnv, Log, PrComment, SessionFile, SourceInfo, UploadEntry } from "./types.js"

export interface BackupOptions {
  readonly sessionDir: string | null
  readonly prNumber: number | null
  readonly repo: string | null
  readonly postComment: boolean
  readonly dryRun: boolean
  readonly verbose: boolean
  readonly background: boolean
  readonly requireComment: boolean
}

export interface UploadOptions {
  readonly contextPath: string
  readonly readyFilePath: string | null
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

type PrContext = { readonly repo: string; readonly prNumber: number }

type PrCommentContext = {
  readonly repo: string
  readonly comment: PrComment
}

type ResolvedBackupContext = {
  readonly source: SourceInfo
  readonly snapshotRef: string
  readonly gitStatus: string | null
  readonly prContext: PrContext | null
}

export type SessionUploadContext = {
  readonly version: 1
  readonly cwd: string
  readonly sessionDir: string | null
  readonly source: SourceInfo
  readonly snapshotRef: string
  readonly gitStatus: string | null
  readonly prComment: PrCommentContext | null
  readonly verbose: boolean
}

const nullableStringField = (value: unknown, key: string): string | null | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const field = value[key]
  return typeof field === "string" || field === null ? field : undefined
}

const nullableNumberField = (value: unknown, key: string): number | null | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const field = value[key]
  return typeof field === "number" || field === null ? field : undefined
}

const booleanField = (value: unknown, key: string): boolean | null => {
  if (!isRecord(value)) {
    return null
  }
  const field = value[key]
  return typeof field === "boolean" ? field : null
}

const parseSourceInfo = (value: unknown): SourceInfo | null => {
  const repo = stringField(value, "repo")
  const branch = stringField(value, "branch")
  const prNumber = nullableNumberField(value, "prNumber")
  const commitSha = stringField(value, "commitSha")
  const createdAt = stringField(value, "createdAt")
  return repo === null || branch === null || prNumber === undefined || commitSha === null || createdAt === null
    ? null
    : { repo, branch, prNumber, commitSha, createdAt }
}

const parsePrCommentContext = (value: unknown): PrCommentContext | null => {
  if (value === null) {
    return null
  }
  const repo = stringField(value, "repo")
  const comment = recordField(value, "comment")
  const id = numberField(comment, "id")
  const url = stringField(comment, "url")
  return repo === null || id === null || url === null ? null : { repo, comment: { id, url } }
}

export const parseUploadContext = (value: unknown): SessionUploadContext | null => {
  const version = numberField(value, "version")
  const cwd = stringField(value, "cwd")
  const sessionDir = nullableStringField(value, "sessionDir")
  const source = parseSourceInfo(recordField(value, "source"))
  const snapshotRef = stringField(value, "snapshotRef")
  const gitStatus = nullableStringField(value, "gitStatus")
  const prComment = parsePrCommentContext(isRecord(value) ? value["prComment"] : undefined)
  const verbose = booleanField(value, "verbose")
  if (
    version !== 1 ||
    cwd === null ||
    sessionDir === undefined ||
    source === null ||
    snapshotRef === null ||
    gitStatus === undefined ||
    prComment === null && isRecord(value) && value["prComment"] !== null ||
    verbose === null
  ) {
    return null
  }
  return { version, cwd, sessionDir, source, snapshotRef, gitStatus, prComment, verbose }
}

const resolveBackupContext = (
  options: BackupOptions,
  cwd: string,
  ghEnv: GhEnv,
  output: Output
): ResolvedBackupContext | null => {
  const verbose = options.verbose
  const repoCandidates = getRepoCandidates(cwd, options.repo, verbose, output)
  if (repoCandidates.length === 0) {
    output.err("[session-backup] Could not determine source repository. Use --repo option.")
    return null
  }
  const sourceRepo = repoCandidates[0]
  if (sourceRepo === undefined) {
    return null
  }
  logVerbose(verbose, output, `Repository: ${sourceRepo}`)

  const branch = runGitCapture(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch === null || branch.length === 0) {
    output.err("[session-backup] Could not determine current branch.")
    return null
  }
  logVerbose(verbose, output, `Branch: ${branch}`)

  const commitSha = runGitCapture(cwd, ["rev-parse", "HEAD"])
  if (commitSha === null || commitSha.length === 0) {
    output.err("[session-backup] Could not determine current commit.")
    return null
  }

  let prContext: PrContext | null = null
  if (options.prNumber !== null) {
    if (prIsOpen(sourceRepo, options.prNumber, ghEnv)) {
      prContext = { repo: sourceRepo, prNumber: options.prNumber }
    } else {
      logVerbose(verbose, output, `Skipping PR comment: PR #${options.prNumber} is not open`)
    }
  } else if (options.postComment || options.requireComment) {
    prContext = findPrContext(repoCandidates, branch, verbose, output, ghEnv)
  }

  if (prContext !== null) {
    logVerbose(verbose, output, `PR number: ${prContext.prNumber} (${prContext.repo})`)
  } else if (options.postComment || options.requireComment) {
    logVerbose(verbose, output, "No PR found for current branch")
  }

  const source = {
    repo: sourceRepo,
    branch,
    prNumber: prContext?.prNumber ?? null,
    commitSha,
    createdAt: new Date().toISOString()
  }
  return {
    source,
    snapshotRef: buildSnapshotRef(sourceRepo, source.prNumber, branch),
    gitStatus: getGitStatus(cwd),
    prContext
  }
}

const createQueuedComment = (
  resolved: ResolvedBackupContext,
  verbose: boolean,
  output: Output,
  ghEnv: GhEnv
): PrCommentContext | null => {
  if (resolved.prContext === null) {
    return null
  }
  logVerbose(verbose, output, `Posting git status comment to PR #${resolved.prContext.prNumber}`)
  const comment = createPrComment(
    resolved.prContext.repo,
    resolved.prContext.prNumber,
    buildCommentBody({ source: resolved.source, upload: { state: "queued" }, gitStatus: resolved.gitStatus }),
    ghEnv
  )
  if (comment === null) {
    output.err("[session-backup] Failed to post PR comment with git status")
    return null
  }
  logVerbose(verbose, output, `Comment posted: ${comment.url}`)
  return { repo: resolved.prContext.repo, comment }
}

const updateUploadComment = (
  context: SessionUploadContext,
  ghEnv: GhEnv,
  output: Output,
  upload: Parameters<typeof buildCommentBody>[0]["upload"]
): void => {
  if (context.prComment === null) {
    return
  }
  const updated = updatePrComment(
    context.prComment.repo,
    context.prComment.comment.id,
    buildCommentBody({ source: context.source, upload, gitStatus: context.gitStatus }),
    ghEnv
  )
  if (!updated) {
    output.err("[session-backup] Failed to update PR comment")
  }
}

const buildReadmeUploadEntry = (repoPath: string, sourcePath: string): UploadEntry => ({
  repoPath,
  sourcePath,
  type: "readme",
  size: fs.statSync(sourcePath).size,
  blobSha: gitBlobShaForFile(sourcePath)
})

const runSessionUpload = (
  context: SessionUploadContext,
  ghEnv: GhEnv,
  output: Output
): number => {
  const verbose = context.verbose
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-repo-"))
  try {
    const sessionDirs = findSessionDirs(context.sessionDir, verbose, output)
    if (sessionDirs.length === 0) {
      logVerbose(verbose, output, "No session directories found")
      updateUploadComment(context, ghEnv, output, { state: "skipped", message: "No session directories found." })
      return 0
    }

    const sessionFiles = sessionDirs.flatMap((dir) => collectSessionFiles(dir.path, dir.name, verbose, output))
    logVerbose(verbose, output, `Total files to backup: ${sessionFiles.length}`)
    if (sessionFiles.length === 0) {
      updateUploadComment(context, ghEnv, output, { state: "skipped", message: "No chat transcripts found." })
      return 0
    }

    const backupRepo = ensureBackupRepo(ghEnv, (message) => logVerbose(verbose, output, message))
    if (backupRepo === null) {
      throw new Error("Failed to resolve or create the private session backup repository")
    }

    const prepared = prepareUploadArtifacts(
      sessionFiles,
      context.snapshotRef,
      backupRepo.fullName,
      backupRepo.defaultBranch,
      tmpDir,
      (message) => logVerbose(verbose, output, message)
    )
    const summary = summarizeFiles(prepared.manifestFiles)
    const sessionRoots = sessionDirs.map((dir) => `~/${dir.name}`)
    const manifestUrl = buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, `${context.snapshotRef}/manifest.json`)
    const readmeRepoPath = `${context.snapshotRef}/README.md`
    const readmeUrl = buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, readmeRepoPath)
    const manifest = buildManifest({
      backupRepo,
      snapshotRef: context.snapshotRef,
      source: context.source,
      files: prepared.manifestFiles,
      createdAt: context.source.createdAt
    })
    const readmePath = path.join(tmpDir, "README.md")
    fs.writeFileSync(
      readmePath,
      buildSnapshotReadme({ backupRepo, source: context.source, manifestUrl, summary, sessionRoots }),
      "utf8"
    )
    const uploadEntries = [...prepared.uploadEntries, buildReadmeUploadEntry(readmeRepoPath, readmePath)]
    logVerbose(verbose, output, `Uploading snapshot to ${backupRepo.fullName}:${context.snapshotRef}`)
    const uploadResult = uploadSnapshot(backupRepo, context.snapshotRef, manifest, uploadEntries, ghEnv)
    if (!uploadResult.changed) {
      output.out(`[session-backup] skipped: no new or changed chat transcripts (${summary.fileCount} files, ${formatBytes(summary.totalBytes)})`)
      printGitStatus(output, context.gitStatus)
      logVerbose(verbose, output, `[session-backup] No backup repo changes for ${backupRepo.fullName}:${context.snapshotRef}`)
      updateUploadComment(context, ghEnv, output, { state: "skipped", message: "No new or changed chat transcripts." })
      return 0
    }
    output.out(`[session-backup] ok: ${context.source.commitSha.slice(0, 12)} (${summary.fileCount} files, ${formatBytes(summary.totalBytes)})`)
    printGitStatus(output, context.gitStatus)
    logVerbose(verbose, output, `[session-backup] Uploaded snapshot to ${backupRepo.fullName}:${context.snapshotRef}`)
    logVerbose(verbose, output, `[session-backup] Manifest: ${uploadResult.manifestUrl}`)
    updateUploadComment(context, ghEnv, output, {
      state: "success",
      manifestUrl: uploadResult.manifestUrl,
      readmeUrl,
      summary
    })
    return 0
  } catch (error) {
    const message = errorMessage(error)
    output.err(`[session-backup] ${message}`)
    updateUploadComment(context, ghEnv, output, { state: "failed", message })
    return 1
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

const writeBackgroundContext = (context: SessionUploadContext): string => {
  const contextPath = path.join(os.tmpdir(), `docker-git-session-upload-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  fs.writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8")
  return contextPath
}

const currentEntrypointPath = (): string | null => {
  const entrypoint = process.argv[1]
  return entrypoint === undefined || entrypoint.length === 0 ? null : entrypoint
}

type BackgroundReadyState =
  | { readonly state: "started" }
  | { readonly state: "failed"; readonly message: string }

const backgroundReadyTimeoutMs = 10_000
const backgroundReadyPollMs = 50

const sleepSync = (durationMs: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs)
}

const writeBackgroundReadyState = (readyFilePath: string | null, state: BackgroundReadyState): void => {
  if (readyFilePath === null) {
    return
  }
  try {
    fs.writeFileSync(readyFilePath, `${JSON.stringify(state)}\n`, "utf8")
  } catch {
    // The parent process also has a timeout fallback; failure to write this
    // handshake file must not block updating the PR comment from the child.
  }
}

const parseBackgroundReadyState = (value: unknown): BackgroundReadyState | null => {
  const state = stringField(value, "state")
  if (state === "started") {
    return { state }
  }
  if (state === "failed") {
    const message = stringField(value, "message")
    return message === null ? null : { state, message }
  }
  return null
}

const readBackgroundReadyState = (readyFilePath: string): BackgroundReadyState | null => {
  try {
    return parseBackgroundReadyState(JSON.parse(fs.readFileSync(readyFilePath, "utf8")))
  } catch {
    return null
  }
}

const waitForBackgroundReady = (readyFilePath: string): BackgroundReadyState | null => {
  const deadline = Date.now() + backgroundReadyTimeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(readyFilePath)) {
      const state = readBackgroundReadyState(readyFilePath)
      if (state !== null) {
        return state
      }
    }
    sleepSync(Math.min(backgroundReadyPollMs, Math.max(1, deadline - Date.now())))
  }
  return null
}

const spawnBackgroundUpload = (context: SessionUploadContext, output: Output): boolean => {
  const contextPath = writeBackgroundContext(context)
  const readyFilePath = path.join(os.tmpdir(), `docker-git-session-upload-ready-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  const entrypoint = currentEntrypointPath()
  const args = entrypoint === null
    ? ["upload", "--context", contextPath, "--ready-file", readyFilePath]
    : [entrypoint, "upload", "--context", contextPath, "--ready-file", readyFilePath]
  if (context.verbose) {
    args.push("--verbose")
  }
  const command = entrypoint === null ? "docker-git-session-sync" : process.execPath
  try {
    const child = spawn(command, args, {
      cwd: context.cwd,
      detached: true,
      stdio: "ignore",
      env: process.env
    })
    child.once("error", (error) => {
      output.err(`[session-backup] Background upload process error: ${errorMessage(error)}`)
    })
    const readyState = waitForBackgroundReady(readyFilePath)
    fs.rmSync(readyFilePath, { force: true })
    if (readyState === null) {
      output.err("[session-backup] Background upload did not report readiness")
      child.unref()
      return false
    }
    if (readyState.state === "failed") {
      output.err(`[session-backup] Background upload failed to start: ${readyState.message}`)
      child.unref()
      return false
    }
    child.unref()
    return true
  } catch (error) {
    fs.rmSync(contextPath, { force: true })
    fs.rmSync(readyFilePath, { force: true })
    output.err(`[session-backup] Failed to start background upload: ${errorMessage(error)}`)
    return false
  }
}

const runDryRun = (
  resolved: ResolvedBackupContext,
  options: BackupOptions,
  ghEnv: GhEnv,
  output: Output
): number => {
  const verbose = options.verbose
  const backupRepo = ensureBackupRepo(ghEnv, (message) => logVerbose(verbose, output, message), false)
  if (backupRepo === null) {
    output.err("[session-backup] Failed to resolve the private session backup repository")
    return 1
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sync-repo-"))
  try {
    const sessionDirs = findSessionDirs(options.sessionDir, verbose, output)
    const sessionFiles = sessionDirs.flatMap((dir) => collectSessionFiles(dir.path, dir.name, verbose, output))
    const prepared = prepareUploadArtifacts(
      sessionFiles,
      resolved.snapshotRef,
      backupRepo.fullName,
      backupRepo.defaultBranch,
      tmpDir,
      (message) => logVerbose(verbose, output, message)
    )
    const summary = summarizeFiles(prepared.manifestFiles)
    const manifestUrl = buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, `${resolved.snapshotRef}/manifest.json`)
    const readmeUrl = buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, `${resolved.snapshotRef}/README.md`)
    output.out(`[session-backup] dry-run: ${resolved.source.commitSha.slice(0, 12)} (${summary.fileCount} files, ${formatBytes(summary.totalBytes)})`)
    printGitStatus(output, resolved.gitStatus)
    logVerbose(verbose, output, `[dry-run] Upload target: ${backupRepo.fullName}:${resolved.snapshotRef}`)
    logVerbose(verbose, output, `[dry-run] README URL: ${readmeUrl}`)
    logVerbose(verbose, output, `[dry-run] Manifest URL: ${manifestUrl}`)
    if (options.postComment && resolved.prContext !== null) {
      logVerbose(verbose, output, `Would post comment to PR #${resolved.prContext.prNumber} in ${resolved.prContext.repo}:`)
      logVerbose(
        verbose,
        output,
        buildCommentBody({
          source: resolved.source,
          upload: { state: "success", manifestUrl, readmeUrl, summary },
          gitStatus: resolved.gitStatus
        })
      )
    }
    return 0
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

export const backupSessions = (options: BackupOptions, cwd: string, output: Output): number => {
  if (process.env["DOCKER_GIT_SKIP_SESSION_BACKUP"] === "1") {
    output.out("[session-backup] Skipped (DOCKER_GIT_SKIP_SESSION_BACKUP=1)")
    return 0
  }

  if (options.requireComment && !options.postComment) {
    output.err("[session-backup] --require-comment cannot be used with --no-comment")
    return 1
  }

  const verbose = options.verbose
  const ghEnv = resolveGhEnvironment(cwd, (message) => logVerbose(verbose, output, message))
  logVerbose(verbose, output, "Starting session backup...")
  const resolved = resolveBackupContext(options, cwd, ghEnv, output)
  if (resolved === null) {
    return 1
  }

  if (options.dryRun) {
    return runDryRun(resolved, options, ghEnv, output)
  }

  const comment = options.postComment ? createQueuedComment(resolved, verbose, output, ghEnv) : null
  if (options.requireComment && comment === null) {
    output.err("[session-backup] Required PR comment was not created")
    return 1
  }

  const uploadContext: SessionUploadContext = {
    version: 1,
    cwd,
    sessionDir: options.sessionDir,
    source: resolved.source,
    snapshotRef: resolved.snapshotRef,
    gitStatus: resolved.gitStatus,
    prComment: comment,
    verbose
  }

  if (options.background) {
    const started = spawnBackgroundUpload(uploadContext, output)
    if (!started) {
      updateUploadComment(uploadContext, ghEnv, output, { state: "failed", message: "Failed to start background upload." })
      return 1
    }
    output.out(`[session-backup] queued: ${resolved.source.commitSha.slice(0, 12)}`)
    printGitStatus(output, resolved.gitStatus)
    return 0
  }

  return runSessionUpload(uploadContext, ghEnv, output)
}

export const uploadFromContext = (options: UploadOptions, cwd: string, output: Output): number => {
  const contextPath = path.resolve(cwd, options.contextPath)
  const readyFilePath = options.readyFilePath === null ? null : path.resolve(cwd, options.readyFilePath)
  try {
    const parsed = parseUploadContext(JSON.parse(fs.readFileSync(contextPath, "utf8")))
    if (parsed === null) {
      writeBackgroundReadyState(readyFilePath, { state: "failed", message: "Invalid upload context" })
      output.err("[session-backup] Invalid upload context")
      return 1
    }
    const context: SessionUploadContext = { ...parsed, verbose: options.verbose || parsed.verbose }
    writeBackgroundReadyState(readyFilePath, { state: "started" })
    const ghEnv = resolveGhEnvironment(context.cwd, (message) => logVerbose(context.verbose, output, message))
    return runSessionUpload(context, ghEnv, output)
  } catch (error) {
    writeBackgroundReadyState(readyFilePath, { state: "failed", message: errorMessage(error) })
    output.err(`[session-backup] ${errorMessage(error)}`)
    return 1
  } finally {
    fs.rmSync(contextPath, { force: true })
  }
}
