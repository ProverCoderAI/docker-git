import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"

import {
  backupDefaultBranch,
  backupRepoName,
  buildBlobUrl,
  buildChunkManifest,
  buildCommitMessage,
  chunkManifestSuffix,
  findGithubTokenInEnvText,
  githubEnvKeys,
  maxRepoFileSize
} from "./core.js"
import { errorMessage, recordField, stringField } from "./json.js"
import {
  decodeGitHubContentResponse,
  decodeGitHubPrComment,
  decodeGitHubRepoInfo,
  decodeGitHubSha,
  decodeGitHubTreeEntries
} from "./schemas.js"
import type {
  BackupRepo,
  GhEnv,
  Log,
  PreparedUploadArtifacts,
  PrComment,
  SessionFile,
  SnapshotManifest,
  TreeEntry,
  TreeSnapshot,
  UploadEntry
} from "./types.js"

const ghMaxBufferBytes = 32 * 1024 * 1024
const dockerGitConfigFile = "docker-git.json"
const projectWalkIgnoreDirNames: ReadonlySet<string> = new Set([".git", "node_modules", ".cache", "tmp"])

interface CommandResult {
  readonly success: boolean
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

interface GhJsonResult extends CommandResult {
  readonly json: unknown
}

interface TreeFileEntry {
  readonly mode: string
  readonly type: string
  readonly sha: string
}

const commandResult = (status: number | null, stdout: string | Buffer, stderr: string | Buffer): CommandResult => ({
  success: status === 0,
  status: status ?? 1,
  stdout: stdout.toString().trim(),
  stderr: stderr.toString().trim()
})

const ensureSuccess = <T extends CommandResult>(result: T, context: string): T => {
  if (!result.success) {
    throw new Error(`${context}: ${result.stderr || result.stdout || `exit ${result.status}`}`)
  }
  return result
}

const ghCommand = (
  args: ReadonlyArray<string>,
  ghEnv: GhEnv,
  inputFilePath: string | null = null
): CommandResult => {
  const resolvedArgs = inputFilePath === null ? args : [...args, "--input", inputFilePath]
  const result = spawnSync("gh", resolvedArgs, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: ghMaxBufferBytes,
    env: ghEnv
  })
  return commandResult(result.status, result.stdout ?? "", result.stderr ?? "")
}

const ghApi = (
  endpoint: string,
  ghEnv: GhEnv,
  options: {
    readonly method?: string
    readonly jq?: string
    readonly rawFields?: Readonly<Record<string, string>>
    readonly body?: unknown
  } = {}
): CommandResult => {
  const args = ["api", endpoint]
  if (options.method !== undefined && options.method !== "GET") {
    args.push("-X", options.method)
  }
  if (options.jq !== undefined) {
    args.push("--jq", options.jq)
  }
  if (options.rawFields !== undefined) {
    for (const [key, value] of Object.entries(options.rawFields)) {
      args.push("-f", `${key}=${value}`)
    }
  }
  if (options.body === undefined) {
    return ghCommand(args, ghEnv)
  }

  const inputFilePath = path.join(os.tmpdir(), `docker-git-gh-api-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  fs.writeFileSync(inputFilePath, JSON.stringify(options.body), "utf8")
  try {
    return ghCommand(args, ghEnv, inputFilePath)
  } finally {
    fs.rmSync(inputFilePath, { force: true })
  }
}

const ghApiJson = (endpoint: string, ghEnv: GhEnv, options: Parameters<typeof ghApi>[2] = {}): GhJsonResult => {
  const result = ghApi(endpoint, ghEnv, options)
  if (!result.success) {
    return { ...result, json: null }
  }
  try {
    const json: unknown = JSON.parse(result.stdout)
    return { ...result, json }
  } catch {
    return { ...result, json: null }
  }
}

export const runGitCapture = (
  cwd: string,
  args: ReadonlyArray<string>,
  env: GhEnv = process.env
): string | null => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env
  })
  return result.status === 0 ? (result.stdout ?? "").trim() : null
}

const resolveViewerLogin = (ghEnv: GhEnv): string =>
  ensureSuccess(ghApi("/user", ghEnv, { jq: ".login" }), "failed to resolve authenticated GitHub login").stdout

const getRepoInfo = (repoFullName: string, ghEnv: GhEnv): GhJsonResult =>
  ghApiJson(`/repos/${repoFullName}`, ghEnv)

export const ensureBackupRepo = (ghEnv: GhEnv, log: Log, createIfMissing: boolean = true): BackupRepo | null => {
  const login = resolveViewerLogin(ghEnv)
  const repoFullName = `${login}/${backupRepoName}`
  let repoResult = getRepoInfo(repoFullName, ghEnv)
  if (!repoResult.success && createIfMissing) {
    log(`Creating private session backup repository for ${login}...`)
    repoResult = ghApiJson("/user/repos", ghEnv, {
      method: "POST",
      body: {
        name: backupRepoName,
        private: true,
        auto_init: true,
        description: "docker-git session backups"
      }
    })
  }
  if (!repoResult.success || repoResult.json === null) {
    return null
  }
  const repoInfo = decodeGitHubRepoInfo(repoResult.json)
  if (repoInfo === null) {
    log(`GitHub repository response for ${repoFullName} was invalid`)
    return null
  }
  const defaultBranch = repoInfo.defaultBranch ?? backupDefaultBranch
  const htmlUrl = repoInfo.htmlUrl ?? `https://github.com/${repoFullName}`
  if (repoInfo.defaultBranch === null) {
    log(`GitHub repository response for ${repoFullName} missing default_branch; using ${defaultBranch}`)
  }
  if (repoInfo.htmlUrl === null) {
    log(`GitHub repository response for ${repoFullName} missing html_url; using ${htmlUrl}`)
  }
  return {
    owner: login,
    repo: backupRepoName,
    fullName: repoFullName,
    defaultBranch,
    htmlUrl
  }
}

const getBranchHeadSha = (repoFullName: string, branch: string, ghEnv: GhEnv): string =>
  ensureSuccess(
    ghApi(`/repos/${repoFullName}/git/ref/heads/${branch}`, ghEnv, { jq: ".object.sha" }),
    `failed to resolve ${repoFullName}@${branch} ref`
  ).stdout

const getCommitTreeSha = (repoFullName: string, commitSha: string, ghEnv: GhEnv): string =>
  ensureSuccess(
    ghApi(`/repos/${repoFullName}/git/commits/${commitSha}`, ghEnv, { jq: ".tree.sha" }),
    `failed to resolve tree for commit ${commitSha}`
  ).stdout

export const getTreeEntries = (repoFullName: string, branch: string, ghEnv: GhEnv): TreeSnapshot => {
  const headSha = getBranchHeadSha(repoFullName, branch, ghEnv)
  const treeSha = getCommitTreeSha(repoFullName, headSha, ghEnv)
  const result = ensureSuccess(
    ghApiJson(`/repos/${repoFullName}/git/trees/${treeSha}?recursive=1`, ghEnv),
    `failed to list tree for ${repoFullName}@${branch}`
  )
  const entries = decodeGitHubTreeEntries(result.json)
  if (entries === null) {
    throw new Error(`GitHub tree response invalid for ${repoFullName}@${branch}`)
  }
  return {
    headSha,
    treeSha,
    entries
  }
}

export const getFileContent = (
  repoFullName: string,
  repoPath: string,
  ghEnv: GhEnv,
  ref: string = backupDefaultBranch
): Buffer => {
  const result = ensureSuccess(
    ghApiJson(`/repos/${repoFullName}/contents/${repoPath}?ref=${encodeURIComponent(ref)}`, ghEnv),
    `failed to fetch ${repoFullName}:${repoPath}`
  )
  const contentResponse = decodeGitHubContentResponse(result.json)
  if (contentResponse === null) {
    throw new Error(`unexpected content payload for ${repoFullName}:${repoPath}`)
  }
  const content = contentResponse.content.replace(/\n/gu, "")
  return Buffer.from(content, "base64")
}

export const createPrComment = (
  repoFullName: string,
  prNumber: number,
  body: string,
  ghEnv: GhEnv,
  log: Log = () => undefined
): PrComment | null => {
  const result = ghApiJson(`/repos/${repoFullName}/issues/${prNumber}/comments`, ghEnv, {
    method: "POST",
    body: { body }
  })
  if (!result.success) {
    log(`GitHub PR comment API failed for ${repoFullName}#${prNumber}: ${result.stderr || result.stdout || `exit ${result.status}`}`)
    return null
  }
  const comment = decodeGitHubPrComment(result.json)
  if (comment === null) {
    log(`GitHub PR comment response invalid for ${repoFullName}#${prNumber}`)
  }
  return comment
}

export const updatePrComment = (
  repoFullName: string,
  commentId: number,
  body: string,
  ghEnv: GhEnv
): boolean =>
  ghApi(`/repos/${repoFullName}/issues/comments/${commentId}`, ghEnv, {
    method: "PATCH",
    body: { body }
  }).success

const getDockerGitProjectsRoot = (): string => {
  const configured = process.env["DOCKER_GIT_PROJECTS_ROOT"]?.trim()
  return configured && configured.length > 0 ? configured : path.join(os.homedir(), ".docker-git")
}

const readJsonFile = (filePath: string): unknown | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

const findDockerGitProjectForTarget = (
  projectsRoot: string,
  targetDir: string,
  log: Log
): { readonly configPath: string; readonly config: unknown } | null => {
  if (!fs.existsSync(projectsRoot)) {
    return null
  }
  const stack: Array<string> = [projectsRoot]
  while (stack.length > 0) {
    const currentDir = stack.pop()
    if (currentDir === undefined) {
      continue
    }
    const configPath = path.join(currentDir, dockerGitConfigFile)
    if (fs.existsSync(configPath)) {
      const config = readJsonFile(configPath)
      const candidateTarget = stringField(recordField(config, "template"), "targetDir")
      if (candidateTarget === targetDir) {
        log(`Resolved docker-git project config: ${configPath}`)
        return { configPath, config }
      }
    }
    let entries: ReadonlyArray<fs.Dirent> = []
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !projectWalkIgnoreDirNames.has(entry.name)) {
        stack.push(path.join(currentDir, entry.name))
      }
    }
  }
  return null
}

const getGithubEnvFileCandidates = (repoRoot: string, log: Log): ReadonlyArray<string> => {
  const projectsRoot = getDockerGitProjectsRoot()
  const candidates: Array<string> = []
  const seen = new Set<string>()
  const project = findDockerGitProjectForTarget(projectsRoot, repoRoot, log)
  const projectEnvGlobal = stringField(recordField(project?.config, "template"), "envGlobalPath")
  if (project?.configPath !== undefined && projectEnvGlobal !== null && projectEnvGlobal.length > 0) {
    const projectEnvPath = path.resolve(path.dirname(project.configPath), projectEnvGlobal)
    candidates.push(projectEnvPath)
    seen.add(projectEnvPath)
  }
  for (const candidate of [
    path.join(projectsRoot, ".orch", "env", "global.env"),
    path.join(projectsRoot, "secrets", "global.env")
  ]) {
    if (!seen.has(candidate)) {
      candidates.push(candidate)
      seen.add(candidate)
    }
  }
  return candidates
}

export const resolveGhEnvironment = (repoRoot: string, log: Log): GhEnv => {
  const env: GhEnv = { ...process.env }
  for (const envPath of getGithubEnvFileCandidates(repoRoot, log)) {
    if (!fs.existsSync(envPath)) {
      continue
    }
    const resolved = findGithubTokenInEnvText(fs.readFileSync(envPath, "utf8"))
    if (resolved !== null) {
      log(`Using ${resolved.key} from ${envPath} for GitHub CLI auth`)
      env["GH_TOKEN"] = resolved.token
      env["GITHUB_TOKEN"] = resolved.token
      return env
    }
  }
  const fromProcess = githubEnvKeys.find((key) => {
    const value = process.env[key]?.trim() ?? ""
    return value.length > 0
  })
  log(fromProcess === undefined
    ? "No GitHub token found in docker-git env files or current process"
    : `Using ${fromProcess} from current process environment for GitHub CLI auth`)
  return env
}

export const gitBlobShaForBuffer = (content: Buffer): string =>
  createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex")

export const gitBlobShaForFile = (sourcePath: string): string =>
  gitBlobShaForBuffer(fs.readFileSync(sourcePath))

const splitLargeFile = (
  sourcePath: string,
  logicalName: string,
  outputDir: string
): { readonly originalSize: number; readonly partNames: ReadonlyArray<string>; readonly manifestName: string } => {
  const totalSize = fs.statSync(sourcePath).size
  const partNames: Array<string> = []
  const fd = fs.openSync(sourcePath, "r")
  const buffer = Buffer.alloc(1024 * 1024)
  let offset = 0
  let remaining = totalSize
  let partIndex = 1
  let partBytesWritten = 0
  let partName = `${logicalName}.part${partIndex}`
  let partPath = path.join(outputDir, partName)
  fs.mkdirSync(path.dirname(partPath), { recursive: true })
  let partFd = fs.openSync(partPath, "w")
  partNames.push(partName)

  try {
    while (remaining > 0) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset)
      if (bytesRead === 0) {
        break
      }
      let chunkOffset = 0
      while (chunkOffset < bytesRead) {
        if (partBytesWritten >= maxRepoFileSize) {
          fs.closeSync(partFd)
          partIndex += 1
          partBytesWritten = 0
          partName = `${logicalName}.part${partIndex}`
          partPath = path.join(outputDir, partName)
          fs.mkdirSync(path.dirname(partPath), { recursive: true })
          partFd = fs.openSync(partPath, "w")
          partNames.push(partName)
        }
        const remainingChunk = bytesRead - chunkOffset
        const remainingPart = maxRepoFileSize - partBytesWritten
        const toWrite = Math.min(remainingChunk, remainingPart)
        fs.writeSync(partFd, buffer.subarray(chunkOffset, chunkOffset + toWrite))
        partBytesWritten += toWrite
        chunkOffset += toWrite
      }
      offset += bytesRead
      remaining -= bytesRead
    }
  } finally {
    fs.closeSync(fd)
    fs.closeSync(partFd)
  }
  return {
    originalSize: totalSize,
    partNames,
    manifestName: `${logicalName}${chunkManifestSuffix}`
  }
}

const stageSessionFile = (
  sourcePath: string,
  logicalName: string,
  tmpDir: string,
  log: Log
): { readonly sourcePath: string; readonly size: number } | null => {
  const stagedPath = path.join(tmpDir, "session-files", ...logicalName.split("/"))
  try {
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true })
    fs.copyFileSync(sourcePath, stagedPath)
    return {
      sourcePath: stagedPath,
      size: fs.statSync(stagedPath).size
    }
  } catch (error) {
    log(`Skipping session file ${logicalName}: ${errorMessage(error)}`)
    return null
  }
}

export const prepareUploadArtifacts = (
  sessionFiles: ReadonlyArray<SessionFile>,
  snapshotRef: string,
  repoFullName: string,
  branch: string,
  tmpDir: string,
  log: Log
): PreparedUploadArtifacts => {
  const uploadEntries: Array<UploadEntry> = []
  const manifestFiles: Array<PreparedUploadArtifacts["manifestFiles"][number]> = []
  for (const file of sessionFiles) {
    const staged = stageSessionFile(file.sourcePath, file.logicalName, tmpDir, log)
    if (staged === null) {
      continue
    }
    if (staged.size <= maxRepoFileSize) {
      const repoPath = `${snapshotRef}/${file.logicalName}`
      const blobSha = gitBlobShaForFile(staged.sourcePath)
      uploadEntries.push({ repoPath, sourcePath: staged.sourcePath, type: "file", size: staged.size, blobSha })
      manifestFiles.push({
        type: "file",
        name: file.logicalName,
        size: staged.size,
        repoPath,
        url: buildBlobUrl(repoFullName, branch, repoPath),
        blobSha
      })
      continue
    }
    log(`Splitting oversized file ${file.logicalName} (${staged.size} bytes)`)
    const split = splitLargeFile(staged.sourcePath, file.logicalName, tmpDir)
    const chunkManifest = buildChunkManifest(file.logicalName, split.originalSize, split.partNames)
    const chunkManifestPath = path.join(tmpDir, split.manifestName)
    fs.mkdirSync(path.dirname(chunkManifestPath), { recursive: true })
    fs.writeFileSync(chunkManifestPath, `${JSON.stringify(chunkManifest, null, 2)}\n`, "utf8")
    const partEntries = split.partNames.map((partName) => {
      const partPath = path.join(tmpDir, partName)
      const repoPath = `${snapshotRef}/${partName}`
      const blobSha = gitBlobShaForFile(partPath)
      uploadEntries.push({
        repoPath,
        sourcePath: partPath,
        type: "chunk-part",
        size: fs.statSync(partPath).size,
        blobSha
      })
      return { name: partName, repoPath, url: buildBlobUrl(repoFullName, branch, repoPath), blobSha }
    })
    const chunkManifestRepoPath = `${snapshotRef}/${split.manifestName}`
    const chunkManifestBlobSha = gitBlobShaForFile(chunkManifestPath)
    uploadEntries.push({
      repoPath: chunkManifestRepoPath,
      sourcePath: chunkManifestPath,
      type: "chunk-manifest",
      size: fs.statSync(chunkManifestPath).size,
      blobSha: chunkManifestBlobSha
    })
    manifestFiles.push({
      type: "chunked",
      name: file.logicalName,
      originalSize: split.originalSize,
      chunkManifestPath: chunkManifestRepoPath,
      chunkManifestUrl: buildBlobUrl(repoFullName, branch, chunkManifestRepoPath),
      chunkManifestBlobSha,
      parts: partEntries
    })
  }
  return { uploadEntries, manifestFiles }
}

export type GitTreeChange = {
  readonly path: string
  readonly mode: "100644"
  readonly type: "blob"
  readonly sha: string | null
}

const buildFileMapFromTreeEntries = (entries: ReadonlyArray<TreeEntry>): Map<string, TreeFileEntry> => {
  const fileMap = new Map<string, TreeFileEntry>()
  for (const entry of entries) {
    if (entry.type !== "tree") {
      fileMap.set(entry.path, { mode: entry.mode, type: entry.type, sha: entry.sha })
    }
  }
  return fileMap
}

const createGitBlob = (repoFullName: string, entry: UploadEntry, ghEnv: GhEnv): string => {
  const content = fs.readFileSync(entry.sourcePath)
  const result = ensureSuccess(
    ghApiJson(`/repos/${repoFullName}/git/blobs`, ghEnv, {
      method: "POST",
      body: {
        content: content.toString("base64"),
        encoding: "base64"
      }
    }),
    `failed to create blob for ${repoFullName}:${entry.repoPath}`
  )
  const sha = decodeGitHubSha(result.json, `GitHub blob response for ${entry.repoPath}`)
  if (sha !== entry.blobSha) {
    throw new Error(`GitHub blob sha mismatch for ${entry.repoPath}`)
  }
  return sha
}

const createGitTree = (
  repoFullName: string,
  baseTreeSha: string,
  changes: ReadonlyArray<GitTreeChange>,
  ghEnv: GhEnv
): string => {
  const result = ensureSuccess(
    ghApiJson(`/repos/${repoFullName}/git/trees`, ghEnv, {
      method: "POST",
      body: {
        base_tree: baseTreeSha,
        tree: changes
      }
    }),
    `failed to create tree in ${repoFullName}`
  )
  return decodeGitHubSha(result.json, `GitHub tree response for ${repoFullName}`)
}

const createGitCommit = (
  backupRepo: BackupRepo,
  parentSha: string,
  treeSha: string,
  source: SnapshotManifest["source"],
  ghEnv: GhEnv
): string => {
  const author = {
    name: backupRepo.owner,
    email: `${backupRepo.owner}@users.noreply.github.com`,
    date: source.createdAt
  }
  const result = ensureSuccess(
    ghApiJson(`/repos/${backupRepo.fullName}/git/commits`, ghEnv, {
      method: "POST",
      body: {
        message: buildCommitMessage(source),
        tree: treeSha,
        parents: [parentSha],
        author,
        committer: author
      }
    }),
    `failed to create commit in ${backupRepo.fullName}`
  )
  return decodeGitHubSha(result.json, `GitHub commit response for ${backupRepo.fullName}`)
}

const updateGitRef = (repoFullName: string, branch: string, commitSha: string, ghEnv: GhEnv): CommandResult =>
  ghApi(`/repos/${repoFullName}/git/refs/heads/${branch}`, ghEnv, {
    method: "PATCH",
    body: {
      sha: commitSha,
      force: false
    }
  })

const isRefUpdateConflict = (result: CommandResult): boolean =>
  /409|Conflict|Reference update failed|fast[- ]forward/iu.test(`${result.stderr}\n${result.stdout}`)

export const buildUploadTreeChanges = (
  repoFullName: string,
  existingEntries: ReadonlyArray<TreeEntry>,
  desiredEntries: ReadonlyArray<UploadEntry>,
  ghEnv: GhEnv
): ReadonlyArray<GitTreeChange> => {
  const existingFileMap = buildFileMapFromTreeEntries(existingEntries)
  const changes: Array<GitTreeChange> = []
  for (const entry of desiredEntries) {
    if (existingFileMap.get(entry.repoPath)?.sha === entry.blobSha) {
      continue
    }
    changes.push({
      path: entry.repoPath,
      mode: "100644",
      type: "blob",
      sha: createGitBlob(repoFullName, entry, ghEnv)
    })
  }
  return changes
}

export const hasChangedUploadEntries = (
  existingEntries: ReadonlyArray<TreeEntry>,
  desiredEntries: ReadonlyArray<UploadEntry>
): boolean => {
  const existingFileMap = buildFileMapFromTreeEntries(existingEntries)
  return desiredEntries.some((entry) => existingFileMap.get(entry.repoPath)?.sha !== entry.blobSha)
}

const isContentUploadEntry = (entry: UploadEntry): boolean =>
  entry.type !== "readme" && entry.type !== "manifest"

export const uploadSnapshot = (
  backupRepo: BackupRepo,
  snapshotRef: string,
  snapshotManifest: SnapshotManifest,
  uploadEntries: ReadonlyArray<UploadEntry>,
  ghEnv: GhEnv
): { readonly changed: boolean; readonly commitSha: string; readonly manifestPath: string; readonly manifestUrl: string } => {
  const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-backup-api-"))
  const manifestPath = `${snapshotRef}/manifest.json`
  const manifestTempPath = path.join(uploadRoot, "manifest.json")
  fs.writeFileSync(manifestTempPath, `${JSON.stringify(snapshotManifest, null, 2)}\n`, "utf8")
  const manifestEntry = {
    repoPath: manifestPath,
    sourcePath: manifestTempPath,
    size: fs.statSync(manifestTempPath).size,
    type: "manifest",
    blobSha: gitBlobShaForFile(manifestTempPath)
  }
  const desiredEntries = [...uploadEntries, manifestEntry]
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const currentTree = getTreeEntries(backupRepo.fullName, backupRepo.defaultBranch, ghEnv)
      if (currentTree.headSha === undefined) {
        throw new Error(`failed to resolve ${backupRepo.fullName}@${backupRepo.defaultBranch} head`)
      }
      if (!hasChangedUploadEntries(currentTree.entries, uploadEntries.filter(isContentUploadEntry))) {
        return {
          changed: false,
          commitSha: currentTree.headSha,
          manifestPath,
          manifestUrl: buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, manifestPath)
        }
      }
      const changes = buildUploadTreeChanges(
        backupRepo.fullName,
        currentTree.entries,
        desiredEntries,
        ghEnv
      )
      if (changes.length === 0) {
        return {
          changed: false,
          commitSha: currentTree.headSha,
          manifestPath,
          manifestUrl: buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, manifestPath)
        }
      }
      const treeSha = createGitTree(backupRepo.fullName, currentTree.treeSha, changes, ghEnv)
      const commitSha = createGitCommit(backupRepo, currentTree.headSha, treeSha, snapshotManifest.source, ghEnv)
      const updateResult = updateGitRef(backupRepo.fullName, backupRepo.defaultBranch, commitSha, ghEnv)
      if (updateResult.success) {
        return {
          changed: true,
          commitSha,
          manifestPath,
          manifestUrl: buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, manifestPath)
        }
      }
      if (attempt >= 3 || !isRefUpdateConflict(updateResult)) {
        throw new Error(`failed to update backup ref: ${updateResult.stderr || updateResult.stdout || `exit ${updateResult.status}`}`)
      }
    }
    throw new Error("failed to update backup ref after 3 attempts")
  } finally {
    fs.rmSync(uploadRoot, { recursive: true, force: true })
  }
}

export const parseJsonBuffer = (buffer: Buffer, context: string): unknown => {
  try {
    return JSON.parse(buffer.toString("utf8"))
  } catch (error) {
    throw new Error(`failed to parse JSON for ${context}: ${errorMessage(error)}`)
  }
}
