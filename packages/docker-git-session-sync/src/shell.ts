import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import {
  backupDefaultBranch,
  backupRepoName,
  buildBlobUrl,
  buildChunkManifest,
  buildCommitMessage,
  chunkManifestSuffix,
  findGithubTokenInEnvText,
  githubEnvKeys,
  maxPushBatchBytes,
  maxRepoFileSize
} from "./core.js"
import { arrayField, errorMessage, isRecord, recordField, stringField } from "./json.js"
import type {
  BackupRepo,
  GhEnv,
  Log,
  PreparedUploadArtifacts,
  SessionFile,
  SnapshotManifest,
  TreeEntry,
  TreeSnapshot,
  UploadEntry
} from "./types.js"

const ghMaxBufferBytes = 32 * 1024 * 1024
const ghGitCredentialHelper = "!gh auth git-credential"
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

interface NamedTreeEntry extends TreeFileEntry {
  readonly name: string
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
  return {
    owner: login,
    repo: backupRepoName,
    fullName: repoFullName,
    defaultBranch: stringField(repoResult.json, "default_branch") ?? backupDefaultBranch,
    htmlUrl: stringField(repoResult.json, "html_url") ?? `https://github.com/${repoFullName}`
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

const isTreeEntry = (value: unknown): value is TreeEntry => {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value["path"] === "string" &&
    typeof value["mode"] === "string" &&
    typeof value["type"] === "string" &&
    typeof value["sha"] === "string"
  )
}

export const getTreeEntries = (repoFullName: string, branch: string, ghEnv: GhEnv): TreeSnapshot => {
  const headSha = getBranchHeadSha(repoFullName, branch, ghEnv)
  const treeSha = getCommitTreeSha(repoFullName, headSha, ghEnv)
  const result = ensureSuccess(
    ghApiJson(`/repos/${repoFullName}/git/trees/${treeSha}?recursive=1`, ghEnv),
    `failed to list tree for ${repoFullName}@${branch}`
  )
  return {
    headSha,
    treeSha,
    entries: arrayField(result.json, "tree").filter(isTreeEntry)
  }
}

const getTreeEntriesForCommit = (repoFullName: string, commitSha: string, ghEnv: GhEnv): TreeSnapshot => {
  const treeSha = getCommitTreeSha(repoFullName, commitSha, ghEnv)
  const result = ensureSuccess(
    ghApiJson(`/repos/${repoFullName}/git/trees/${treeSha}?recursive=1`, ghEnv),
    `failed to list tree for commit ${commitSha} in ${repoFullName}`
  )
  return {
    treeSha,
    entries: arrayField(result.json, "tree").filter(isTreeEntry)
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
  const encoding = stringField(result.json, "encoding")
  const content = stringField(result.json, "content")?.replace(/\n/gu, "") ?? ""
  if (encoding !== "base64" || content.length === 0) {
    throw new Error(`unexpected content payload for ${repoFullName}:${repoPath}`)
  }
  return Buffer.from(content, "base64")
}

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
    if (file.size <= maxRepoFileSize) {
      const repoPath = `${snapshotRef}/${file.logicalName}`
      uploadEntries.push({ repoPath, sourcePath: file.sourcePath, type: "file", size: file.size })
      manifestFiles.push({
        type: "file",
        name: file.logicalName,
        size: file.size,
        repoPath,
        url: buildBlobUrl(repoFullName, branch, repoPath)
      })
      continue
    }
    log(`Splitting oversized file ${file.logicalName} (${file.size} bytes)`)
    const split = splitLargeFile(file.sourcePath, file.logicalName, tmpDir)
    const chunkManifest = buildChunkManifest(file.logicalName, split.originalSize, split.partNames)
    const chunkManifestPath = path.join(tmpDir, split.manifestName)
    fs.mkdirSync(path.dirname(chunkManifestPath), { recursive: true })
    fs.writeFileSync(chunkManifestPath, `${JSON.stringify(chunkManifest, null, 2)}\n`, "utf8")
    const partEntries = split.partNames.map((partName) => {
      const partPath = path.join(tmpDir, partName)
      const repoPath = `${snapshotRef}/${partName}`
      uploadEntries.push({ repoPath, sourcePath: partPath, type: "chunk-part", size: fs.statSync(partPath).size })
      return { name: partName, repoPath, url: buildBlobUrl(repoFullName, branch, repoPath) }
    })
    const chunkManifestRepoPath = `${snapshotRef}/${split.manifestName}`
    uploadEntries.push({
      repoPath: chunkManifestRepoPath,
      sourcePath: chunkManifestPath,
      type: "chunk-manifest",
      size: fs.statSync(chunkManifestPath).size
    })
    manifestFiles.push({
      type: "chunked",
      name: file.logicalName,
      originalSize: split.originalSize,
      chunkManifestPath: chunkManifestRepoPath,
      chunkManifestUrl: buildBlobUrl(repoFullName, branch, chunkManifestRepoPath),
      parts: partEntries
    })
  }
  return { uploadEntries, manifestFiles }
}

const splitUploadEntriesIntoBatches = (uploadEntries: ReadonlyArray<UploadEntry>): ReadonlyArray<ReadonlyArray<UploadEntry>> => {
  const batches: Array<ReadonlyArray<UploadEntry>> = []
  let currentBatch: Array<UploadEntry> = []
  let currentBatchBytes = 0
  for (const entry of uploadEntries) {
    if (currentBatch.length > 0 && currentBatchBytes + entry.size > maxPushBatchBytes) {
      batches.push(currentBatch)
      currentBatch = []
      currentBatchBytes = 0
    }
    currentBatch.push(entry)
    currentBatchBytes += entry.size
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }
  return batches
}

const runGitCommand = (repoDir: string, args: ReadonlyArray<string>, env: GhEnv, input?: string): CommandResult => {
  const result = spawnSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "protocol.version=2", "-C", repoDir, ...args],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env, input }
  )
  return commandResult(result.status, result.stdout ?? "", result.stderr ?? "")
}

const buildGitPushEnv = (ghEnv: GhEnv, token: string): GhEnv => ({
  ...ghEnv,
  GH_TOKEN: token,
  GITHUB_TOKEN: token,
  GIT_AUTH_TOKEN: token,
  GIT_TERMINAL_PROMPT: "0"
})

const initializeUploadRepo = (repoDir: string, backupRepo: BackupRepo, gitEnv: GhEnv): void => {
  ensureSuccess(runGitCommand(repoDir, ["init", "-q"], gitEnv), `failed to init git repo ${repoDir}`)
  ensureSuccess(
    runGitCommand(repoDir, ["remote", "add", "origin", `https://github.com/${backupRepo.fullName}.git`], gitEnv),
    `failed to configure git remote for ${backupRepo.fullName}`
  )
}

const fetchRemoteBranchTip = (repoDir: string, branch: string, gitEnv: GhEnv): string => {
  ensureSuccess(
    runGitCommand(
      repoDir,
      [
        "-c",
        `credential.helper=${ghGitCredentialHelper}`,
        "fetch",
        "--quiet",
        "--no-tags",
        "--depth=1",
        "--filter=blob:none",
        "origin",
        `refs/heads/${branch}:refs/remotes/origin/${branch}`
      ],
      gitEnv
    ),
    `failed to fetch ${branch} tip from backup repository`
  )
  return ensureSuccess(
    runGitCommand(repoDir, ["rev-parse", `refs/remotes/origin/${branch}`], gitEnv),
    `failed to resolve fetched ${branch} tip`
  ).stdout
}

const hashFileObject = (repoDir: string, sourcePath: string, gitEnv: GhEnv): string =>
  ensureSuccess(runGitCommand(repoDir, ["hash-object", "-w", sourcePath], gitEnv), `failed to hash ${sourcePath}`).stdout

const createTreeObject = (repoDir: string, entries: ReadonlyArray<NamedTreeEntry>, gitEnv: GhEnv): string => {
  const body = entries
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.mode} ${entry.type} ${entry.sha}\t${entry.name}`)
    .join("\n")
  return ensureSuccess(
    runGitCommand(repoDir, ["mktree", "--missing"], gitEnv, body.length > 0 ? `${body}\n` : ""),
    "failed to create git tree"
  ).stdout
}

const createCommitObject = (
  repoDir: string,
  treeSha: string,
  parentSha: string,
  message: string,
  createdAt: string,
  owner: string,
  gitEnv: GhEnv
): string => {
  const authorEmail = `${owner}@users.noreply.github.com`
  const unixSeconds = Math.floor(new Date(createdAt).getTime() / 1000)
  const commitBody = [
    `tree ${treeSha}`,
    `parent ${parentSha}`,
    `author ${owner} <${authorEmail}> ${unixSeconds} +0000`,
    `committer ${owner} <${authorEmail}> ${unixSeconds} +0000`,
    "",
    message,
    ""
  ].join("\n")
  return ensureSuccess(
    runGitCommand(repoDir, ["hash-object", "-t", "commit", "-w", "--stdin"], gitEnv, commitBody),
    "failed to create git commit"
  ).stdout
}

const updateLocalRef = (repoDir: string, refName: string, commitSha: string, gitEnv: GhEnv): void => {
  ensureSuccess(runGitCommand(repoDir, ["update-ref", refName, commitSha], gitEnv), `failed to update local ref ${refName}`)
}

const isNonFastForwardPushError = (result: CommandResult): boolean =>
  /non-fast-forward|fetch first|rejected/iu.test(`${result.stderr}\n${result.stdout}`)

const pushCommitToBranch = (repoDir: string, sourceRef: string, branch: string, gitEnv: GhEnv): CommandResult =>
  runGitCommand(
    repoDir,
    ["-c", `credential.helper=${ghGitCredentialHelper}`, "push", "origin", `${sourceRef}:refs/heads/${branch}`],
    gitEnv
  )

const buildFileMapFromTreeEntries = (entries: ReadonlyArray<TreeEntry>): Map<string, TreeFileEntry> => {
  const fileMap = new Map<string, TreeFileEntry>()
  for (const entry of entries) {
    if (entry.type !== "tree") {
      fileMap.set(entry.path, { mode: entry.mode, type: entry.type, sha: entry.sha })
    }
  }
  return fileMap
}

const addChild = (childrenByDir: Map<string, Array<NamedTreeEntry>>, dirPath: string, child: NamedTreeEntry): void => {
  const current = childrenByDir.get(dirPath) ?? []
  current.push(child)
  childrenByDir.set(dirPath, current)
}

const writeMergedTree = (
  repoDir: string,
  existingEntries: ReadonlyArray<TreeEntry>,
  newEntries: ReadonlyArray<{ readonly repoPath: string; readonly sha: string }>,
  gitEnv: GhEnv
): string => {
  const fileMap = buildFileMapFromTreeEntries(existingEntries)
  for (const entry of newEntries) {
    fileMap.set(entry.repoPath, { mode: "100644", type: "blob", sha: entry.sha })
  }
  const directories = new Set<string>([""])
  const childrenByDir = new Map<string, Array<NamedTreeEntry>>()
  for (const [repoPath, entry] of fileMap.entries()) {
    const segments = repoPath.split("/")
    const name = segments.pop()
    const dirPath = segments.join("/")
    if (name === undefined || name.length === 0) {
      continue
    }
    directories.add(dirPath)
    for (let index = 1; index <= segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"))
    }
    addChild(childrenByDir, dirPath, { name, mode: entry.mode, type: entry.type, sha: entry.sha })
  }
  const orderedDirectories = Array.from(directories).sort((left, right) => {
    const depthDiff = right.split("/").length - left.split("/").length
    return depthDiff !== 0 ? depthDiff : right.localeCompare(left)
  })
  for (const dirPath of orderedDirectories) {
    if (dirPath.length === 0) {
      continue
    }
    const treeSha = createTreeObject(repoDir, childrenByDir.get(dirPath) ?? [], gitEnv)
    const segments = dirPath.split("/")
    const name = segments.pop()
    if (name !== undefined && name.length > 0) {
      addChild(childrenByDir, segments.join("/"), { name, mode: "040000", type: "tree", sha: treeSha })
    }
  }
  return createTreeObject(repoDir, childrenByDir.get("") ?? [], gitEnv)
}

const buildUploadCommitMessage = (source: SnapshotManifest["source"], batchIndex: number, batchCount: number): string =>
  batchCount <= 1 ? buildCommitMessage(source) : `${buildCommitMessage(source)} [batch ${batchIndex}/${batchCount}]`

export const uploadSnapshot = (
  backupRepo: BackupRepo,
  snapshotRef: string,
  snapshotManifest: SnapshotManifest,
  uploadEntries: ReadonlyArray<UploadEntry>,
  ghEnv: GhEnv
): { readonly commitSha: string; readonly manifestPath: string; readonly manifestUrl: string } => {
  const token = ghEnv["GITHUB_TOKEN"]?.trim() || ghEnv["GH_TOKEN"]?.trim() || ""
  if (token.length === 0) {
    throw new Error("GitHub token missing for backup repository push")
  }
  const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-backup-git-push-"))
  const manifestPath = `${snapshotRef}/manifest.json`
  const manifestTempPath = path.join(uploadRoot, "manifest.json")
  fs.writeFileSync(manifestTempPath, `${JSON.stringify(snapshotManifest, null, 2)}\n`, "utf8")
  const manifestEntry = {
    repoPath: manifestPath,
    sourcePath: manifestTempPath,
    size: fs.statSync(manifestTempPath).size
  }
  const uploadBatches = splitUploadEntriesIntoBatches([...uploadEntries, manifestEntry])
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const repoDir = path.join(uploadRoot, `attempt-${attempt}`, "repo")
      fs.mkdirSync(repoDir, { recursive: true })
      const gitEnv = buildGitPushEnv(ghEnv, token)
      initializeUploadRepo(repoDir, backupRepo, gitEnv)
      let headSha = fetchRemoteBranchTip(repoDir, backupRepo.defaultBranch, gitEnv)
      let existingEntries = getTreeEntriesForCommit(backupRepo.fullName, headSha, ghEnv).entries
      let lastCommitSha = headSha
      let shouldRetry = false
      for (let batchIndex = 0; batchIndex < uploadBatches.length; batchIndex += 1) {
        const batch = uploadBatches[batchIndex] ?? []
        const hashedEntries = batch.map((entry) => ({
          repoPath: entry.repoPath,
          sha: hashFileObject(repoDir, entry.sourcePath, gitEnv)
        }))
        const nextTreeSha = writeMergedTree(repoDir, existingEntries, hashedEntries, gitEnv)
        const commitSha = createCommitObject(
          repoDir,
          nextTreeSha,
          headSha,
          buildUploadCommitMessage(snapshotManifest.source, batchIndex + 1, uploadBatches.length),
          snapshotManifest.source.createdAt,
          backupRepo.owner,
          gitEnv
        )
        const localRef = `refs/heads/session-backup-upload-${attempt}-${batchIndex + 1}`
        updateLocalRef(repoDir, localRef, commitSha, gitEnv)
        const pushResult = pushCommitToBranch(repoDir, localRef, backupRepo.defaultBranch, gitEnv)
        if (!pushResult.success) {
          if (attempt < 3 && isNonFastForwardPushError(pushResult)) {
            shouldRetry = true
            break
          }
          throw new Error(`failed to push backup commit: ${pushResult.stderr || pushResult.stdout || `exit ${pushResult.status}`}`)
        }
        headSha = commitSha
        lastCommitSha = commitSha
        existingEntries = existingEntries.concat(
          hashedEntries.map((entry) => ({ path: entry.repoPath, mode: "100644", type: "blob", sha: entry.sha }))
        )
      }
      if (!shouldRetry) {
        return {
          commitSha: lastCommitSha,
          manifestPath,
          manifestUrl: buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, manifestPath)
        }
      }
    }
    throw new Error("failed to push backup commit after 3 attempts")
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
