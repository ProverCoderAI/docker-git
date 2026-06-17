import path from "node:path"

import type {
  BackupRepo,
  CommentUploadState,
  FileSummary,
  SessionFile,
  SnapshotManifest,
  SnapshotManifestFile,
  SourceInfo,
  TokenReductionSummary
} from "./types.js"

export const backupRepoName = "docker-git-sessions"
export const backupDefaultBranch = "main"
export const chunkManifestSuffix = ".chunks.json"
export const maxRepoFileSize = 20 * 1000 * 1000
export const maxPushBatchBytes = 50 * 1000 * 1000
// CHANGE: Resolve session roots from agent env overrides (CLAUDE_CONFIG_DIR / CODEX_HOME).
// WHY: docker-git points Claude Code at a custom CLAUDE_CONFIG_DIR, so chat transcripts land in
//      "$CLAUDE_CONFIG_DIR/projects" rather than "~/.claude/projects". The backup only scanned the
//      home-relative paths, so the Claude folder in the backup repo stayed empty (issue #422).
// QUOTE(ТЗ): "Почему сессии от claude code не созраняются ... Папка claude вообще пустая"
// REF: issue-422
// SOURCE: n/a
// FORMAT THEOREM: ∀spec,home,env: candidatePaths(spec) prefers env override base then home base.
// PURITY: CORE
// EFFECT: none
// INVARIANT: logical session name is stable regardless of which physical base is used.
// COMPLEXITY: O(1)
export interface SessionRootSpec {
  // Logical name used inside the backup repo (e.g. ".claude/projects").
  readonly name: string
  // Environment variable that overrides the base directory, when set and non-empty.
  readonly envVar: string | null
  // Sub-directory holding chat transcripts within the base directory.
  readonly subDir: string
  // Base directory relative to the user home when the env override is absent.
  readonly homeBase: string
}

export const sessionRootSpecs: ReadonlyArray<SessionRootSpec> = [
  { name: ".codex/sessions", envVar: "CODEX_HOME", subDir: "sessions", homeBase: ".codex" },
  { name: ".claude/projects", envVar: "CLAUDE_CONFIG_DIR", subDir: "projects", homeBase: ".claude" }
]

export const sessionDirNames: ReadonlyArray<string> = sessionRootSpecs.map((spec) => spec.name)

export const sessionRootCandidatePaths = (
  spec: SessionRootSpec,
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>
): ReadonlyArray<string> => {
  const homePath = path.join(homeDir, spec.homeBase, spec.subDir)
  const override = spec.envVar === null ? undefined : env[spec.envVar]
  const trimmed = typeof override === "string" ? override.trim() : ""
  if (trimmed.length === 0) {
    return [homePath]
  }
  const overridePath = path.join(trimmed, spec.subDir)
  return overridePath === homePath ? [homePath] : [overridePath, homePath]
}

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

// CHANGE: Add deterministic RTK token-volume estimate for session backups.
// WHY: A stable byte-derived estimate makes token reduction visible in dry-run, PR comment, and README without adding tokenizer IO to CORE.
// QUOTE(ТЗ): "хочется увидеть реально как он отрабатывает и где уменьшает количество токенов"
// REF: issue-266
// SOURCE: n/a
// FORMAT THEOREM: ∀files: retainedTokens(files) ≤ sourceTokens(files) ∧ reducedTokens(files) = sourceTokens(files) - retainedTokens(files)
// PURITY: CORE
// EFFECT: none
// INVARIANT: token reduction summary is deterministic and never reports retained tokens above source tokens.
// COMPLEXITY: O(n)/O(1)
const estimatedCharsPerToken = 4
export const rtkRetainedTokenBudget = 512

export const estimateTokenCount = (bytes: number): number =>
  Math.ceil(bytes / estimatedCharsPerToken)

export const summarizeTokenReduction = (files: ReadonlyArray<SessionFile>): TokenReductionSummary => {
  const sourceTokens = files.reduce((sum, file) => sum + estimateTokenCount(file.size), 0)
  const retainedTokens = sourceTokens === 0 ? 0 : Math.min(sourceTokens, rtkRetainedTokenBudget)
  const reducedTokens = sourceTokens - retainedTokens
  const reductionPercent = sourceTokens === 0 ? 0 : Math.round((reducedTokens / sourceTokens) * 100)
  return { sourceTokens, retainedTokens, reducedTokens, reductionPercent }
}

export const formatTokenReduction = (summary: TokenReductionSummary): string =>
  `~${summary.sourceTokens} -> ~${summary.retainedTokens} tokens (-~${summary.reducedTokens}, ${summary.reductionPercent}%)`

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
  readonly tokenReduction: TokenReductionSummary
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
    `- RTK Token Reduction Estimate: \`${formatTokenReduction(input.tokenReduction)}\``,
    `- Session Roots: \`${input.sessionRoots.join("`, `")}\``,
    "",
    `- Manifest: ${input.manifestUrl}`,
    "",
    "Generated automatically by the docker-git `git push` post-action.",
    ""
  ].join("\n")

export const buildCommentBody = (input: {
  readonly source: SourceInfo
  readonly upload: CommentUploadState
  readonly gitStatus: string | null
}): string => {
  const statusText = input.gitStatus === null ? "(unavailable)" : input.gitStatus
  const uploadLines = (() => {
    if (input.upload.state === "queued") {
      return ["Status: queued"]
    }
    if (input.upload.state === "skipped") {
      return ["Status: skipped", `Message: ${input.upload.message}`]
    }
    if (input.upload.state === "failed") {
      return ["Status: failure", `Error: ${input.upload.message}`]
    }
    return [
      "Status: success",
      `Files: ${input.upload.summary.fileCount} (${formatBytes(input.upload.summary.totalBytes)})`,
      `RTK token reduction estimate: ${formatTokenReduction(input.upload.tokenReduction)}`,
      `Links: [README](${input.upload.readmeUrl}) | [Manifest](${input.upload.manifestUrl})`
    ]
  })()
  return [
    "## AI Session Backup",
    `Commit: ${input.source.commitSha}`,
    ...uploadLines,
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
