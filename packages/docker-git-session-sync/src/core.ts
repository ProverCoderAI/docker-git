import path from "node:path"

import type {
  BackupRepo,
  FileSummary,
  SessionFile,
  SnapshotManifest,
  SnapshotManifestFile,
  SourceInfo
} from "./types.js"

export const backupRepoName = "docker-git-sessions"
export const backupDefaultBranch = "main"
export const chunkManifestSuffix = ".chunks.json"
export const maxRepoFileSize = 99 * 1000 * 1000
export const maxPushBatchBytes = 50 * 1000 * 1000
export const sessionDirNames: ReadonlyArray<string> = [".codex/sessions", ".claude/projects"]
export const sessionWalkIgnoreDirNames: ReadonlySet<string> = new Set([".git", "node_modules", "tmp"])
export const githubEnvKeys: ReadonlyArray<string> = ["GITHUB_TOKEN", "GH_TOKEN"]

export const toLogicalRelativePath = (relativePath: string): string =>
  relativePath.split(path.sep).join(path.posix.sep)

export const shouldIgnoreSessionPath = (relativePath: string): boolean => {
  const logicalPath = toLogicalRelativePath(relativePath)
  return logicalPath === "tmp" || logicalPath.startsWith("tmp/") || logicalPath.includes("/tmp/")
}

export const isPathWithinParent = (targetPath: string, parentPath: string): boolean => {
  const relative = path.relative(parentPath, targetPath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export const parseEnvText = (text: string): ReadonlyArray<{ readonly key: string; readonly value: string }> => {
  const entries: Array<{ readonly key: string; readonly value: string }> = []
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      entries.push({ key: match[1], value: match[2] })
    }
  }
  return entries
}

export const findGithubTokenInEnvText = (
  text: string
): { readonly key: string; readonly token: string } | null => {
  const entries = parseEnvText(text)
  for (const key of githubEnvKeys) {
    const entry = entries.find((item) => item.key === key)
    const token = entry?.value.trim() ?? ""
    if (token.length > 0) {
      return { key, token }
    }
  }
  return null
}

export const buildBlobUrl = (repoFullName: string, branch: string, repoPath: string): string =>
  `https://github.com/${repoFullName}/blob/${encodeURIComponent(branch)}/${
    repoPath.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  }`

export const toSnapshotStamp = (createdAt: string): string =>
  createdAt.replaceAll(":", "-").replaceAll(".", "-")

const branchSlugPattern = /[^A-Za-z0-9._-]+/gu

export const toBranchSnapshotSlug = (branch: string): string => {
  const slug = branch.replace(branchSlugPattern, "-").replace(/^-+|-+$/gu, "")
  return slug.length === 0 ? "detached" : slug
}

export const buildSnapshotRef = (
  sourceRepo: string,
  prNumber: number | null,
  branch: string
): string =>
  prNumber === null
    ? `${sourceRepo}/branch-${toBranchSnapshotSlug(branch)}/current`
    : `${sourceRepo}/pr-${prNumber}/current`

export const isChatTranscriptPath = (logicalName: string): boolean => {
  const logicalPath = toLogicalRelativePath(logicalName)
  return (
    logicalPath.startsWith(".codex/sessions/")
    || logicalPath.startsWith(".claude/projects/")
  ) && logicalPath.endsWith(".jsonl")
}

export const buildCommitMessage = (source: SourceInfo): string =>
  `session-backup: ${source.repo} ${source.branch} ${source.commitSha.slice(0, 12)} ${
    toSnapshotStamp(source.createdAt)
  }`

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(2)} MB`
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(2)} KB`
  }
  return `${bytes} B`
}

export const summarizeFiles = (files: ReadonlyArray<SnapshotManifestFile>): FileSummary => ({
  fileCount: files.length,
  totalBytes: files.reduce(
    (sum, file) => sum + (file.type === "chunked" ? file.originalSize : file.size),
    0
  )
})

export const buildManifest = (input: {
  readonly backupRepo: BackupRepo
  readonly snapshotRef: string
  readonly source: SourceInfo
  readonly files: ReadonlyArray<SnapshotManifestFile>
  readonly createdAt: string
}): SnapshotManifest => ({
  version: 1,
  createdAt: input.createdAt,
  storage: {
    repo: input.backupRepo.fullName,
    branch: input.backupRepo.defaultBranch,
    snapshotRef: input.snapshotRef
  },
  source: input.source,
  files: input.files
})

export const buildSnapshotReadme = (input: {
  readonly backupRepo: BackupRepo
  readonly source: SourceInfo
  readonly manifestUrl: string
  readonly summary: FileSummary
  readonly sessionRoots: ReadonlyArray<string>
}): string =>
  [
    "# AI Session Backup",
    "",
    "This snapshot contains AI session data used during development.",
    "",
    `- Backup Repo: \`${input.backupRepo.fullName}\``,
    `- Source Repo: \`${input.source.repo}\``,
    `- Source Branch: \`${input.source.branch}\``,
    `- Source Commit: \`${input.source.commitSha}\``,
    input.source.prNumber === null ? "- Pull Request: none" : `- Pull Request: #${input.source.prNumber}`,
    `- Created At: \`${input.source.createdAt}\``,
    `- Files: \`${input.summary.fileCount}\``,
    `- Total Size: \`${formatBytes(input.summary.totalBytes)}\``,
    `- Session Roots: \`${input.sessionRoots.join("`, `")}\``,
    "",
    `- Manifest: ${input.manifestUrl}`,
    "",
    "Generated automatically by the docker-git `git push` post-action.",
    ""
  ].join("\n")

export const buildCommentBody = (input: {
  readonly source: SourceInfo
  readonly manifestUrl: string
  readonly readmeUrl: string
  readonly summary: FileSummary
  readonly gitStatus: string | null
}): string => {
  const statusText = input.gitStatus === null ? "(unavailable)" : input.gitStatus
  return [
    "## AI Session Backup",
    `Commit: ${input.source.commitSha}`,
    `Files: ${input.summary.fileCount} (${formatBytes(input.summary.totalBytes)})`,
    `Links: [README](${input.readmeUrl}) | [Manifest](${input.manifestUrl})`,
    "",
    "`git status`",
    "```",
    statusText,
    "```",
    `<!-- docker-git-session-backup:${input.source.commitSha}:${input.source.createdAt} -->`
  ].join("\n")
}

export const sanitizeSnapshotRefForOutput = (snapshotRef: string): string =>
  snapshotRef.replace(/[\\/]/gu, "_")

export const buildChunkManifest = (
  logicalName: string,
  originalSize: number,
  partNames: ReadonlyArray<string>
) => ({
  original: logicalName,
  originalSize,
  parts: partNames,
  splitAt: maxRepoFileSize,
  partsCount: partNames.length,
  createdAt: new Date().toISOString()
})

export const sortSessionFiles = (files: ReadonlyArray<SessionFile>): ReadonlyArray<SessionFile> =>
  files.slice().sort((left, right) => left.logicalName.localeCompare(right.logicalName))
