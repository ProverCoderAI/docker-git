import { trimLeftChar, trimRightChar } from "./strings.js"

const slugify = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-+/g, "-")
  const withoutLeading = trimLeftChar(normalized, "-")
  const cleaned = trimRightChar(withoutLeading, "-")

  return cleaned.length > 0 ? cleaned : "app"
}

// CHANGE: derive a stable repo slug from a repo URL
// WHY: generate deterministic container/service names per repository
// QUOTE(ТЗ): "по факту он должен создавтаь постоянно новый контейнер для нового репозитория"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall url: slug(url) = s -> deterministic(s)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: slug is lowercase and non-empty
// COMPLEXITY: O(n) where n = |url|
export const deriveRepoSlug = (repoUrl: string): string => {
  const trimmed = trimRightChar(repoUrl.trim(), "/")
  if (trimmed.length === 0) {
    return "app"
  }

  const lastSlash = trimmed.lastIndexOf("/")
  const lastColon = trimmed.lastIndexOf(":")
  const pivot = Math.max(lastSlash, lastColon)
  const segment = pivot >= 0 ? trimmed.slice(pivot + 1) : trimmed
  const withoutGit = segment.endsWith(".git") ? segment.slice(0, -4) : segment

  return slugify(withoutGit)
}

type RepoPathParts = {
  readonly ownerParts: ReadonlyArray<string>
  readonly repo: string
  readonly pathParts: ReadonlyArray<string>
}

const stripGitSuffix = (segment: string): string => segment.endsWith(".git") ? segment.slice(0, -4) : segment

const normalizePathParts = (pathPart: string): ReadonlyArray<string> => {
  const cleaned = trimLeftChar(pathPart, "/")
  if (cleaned.length === 0) {
    return []
  }
  const rawParts = cleaned.split("/").filter(Boolean)
  return rawParts.map((part, index) => index === rawParts.length - 1 ? stripGitSuffix(part) : part)
}

const extractFromScheme = (trimmed: string): ReadonlyArray<string> | null => {
  const schemeIndex = trimmed.indexOf("://")
  if (schemeIndex === -1) {
    return null
  }
  const afterScheme = trimmed.slice(schemeIndex + 3)
  const firstSlash = afterScheme.indexOf("/")
  if (firstSlash === -1) {
    return []
  }
  return normalizePathParts(afterScheme.slice(firstSlash + 1))
}

const extractFromColon = (trimmed: string): ReadonlyArray<string> | null => {
  const colonIndex = trimmed.indexOf(":")
  if (colonIndex === -1) {
    return null
  }
  return normalizePathParts(trimmed.slice(colonIndex + 1))
}

const extractFromSlash = (trimmed: string): ReadonlyArray<string> | null => {
  const slashIndex = trimmed.indexOf("/")
  if (slashIndex === -1) {
    return null
  }
  return normalizePathParts(trimmed.slice(slashIndex + 1))
}

const extractRepoPathParts = (repoUrl: string): ReadonlyArray<string> => {
  const trimmed = trimRightChar(repoUrl.trim(), "/")
  if (trimmed.length === 0) {
    return []
  }

  const fromScheme = extractFromScheme(trimmed)
  if (fromScheme !== null) {
    return fromScheme
  }

  const fromColon = extractFromColon(trimmed)
  if (fromColon !== null) {
    return fromColon
  }

  const fromSlash = extractFromSlash(trimmed)
  if (fromSlash !== null) {
    return fromSlash
  }

  return [stripGitSuffix(trimmed)]
}

const normalizeRepoSegment = (segment: string, fallback: string): string => {
  const normalized = slugify(segment)
  return normalized.length > 0 ? normalized : fallback
}

// CHANGE: derive stable owner/repo path parts from a repo URL
// WHY: avoid collisions when orgs have identical repo names
// QUOTE(ТЗ): "пути учитывают организацию в которой это лежит"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall url: parts(url) -> deterministic(parts)
// PURITY: CORE
// EFFECT: Effect<RepoPathParts, never, never>
// INVARIANT: path parts are slugified and non-empty
// COMPLEXITY: O(n) where n = |url|
export const deriveRepoPathParts = (repoUrl: string): RepoPathParts => {
  const repoSlug = deriveRepoSlug(repoUrl)
  const rawParts = extractRepoPathParts(repoUrl)
  if (rawParts.length === 0) {
    return { ownerParts: [], repo: repoSlug, pathParts: [repoSlug] }
  }

  const rawRepo = rawParts.at(-1) ?? repoSlug
  const repo = normalizeRepoSegment(rawRepo, repoSlug)
  const ownerParts = rawParts
    .slice(0, -1)
    .map((part) => normalizeRepoSegment(part, "org"))
    .filter((part) => part.length > 0)
  const pathParts = ownerParts.length > 0 ? [...ownerParts, repo] : [repo]

  return { ownerParts, repo, pathParts }
}

type ResolvedRepoInput = {
  readonly repoUrl: string
  readonly repoRef?: string
}

const parseGithubPrUrl = (input: string): ResolvedRepoInput | null => {
  const trimmed = input.trim()
  const pattern = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i
  const match = pattern.exec(trimmed)
  if (!match) {
    return null
  }

  const owner = match[1]?.trim()
  const repoRaw = match[2]?.trim()
  const prNumber = match[3]?.trim()

  if (!owner || !repoRaw || !prNumber) {
    return null
  }

  const repo = stripGitSuffix(repoRaw)
  return {
    repoUrl: `https://github.com/${owner}/${repo}.git`,
    repoRef: `refs/pull/${prNumber}/head`
  }
}

// CHANGE: normalize repo input and PR URLs into repo + ref
// WHY: allow cloning GitHub PR links directly
// QUOTE(ТЗ): "клонировть по cсылке на PR"
// REF: user-request-2026-01-28-pr
// SOURCE: n/a
// FORMAT THEOREM: forall url: resolve(url) -> deterministic(url, ref)
// PURITY: CORE
// EFFECT: Effect<ResolvedRepoInput, never, never>
// INVARIANT: PR URL yields repoUrl + refs/pull/<id>/head
// COMPLEXITY: O(n) where n = |url|
export const resolveRepoInput = (repoUrl: string): ResolvedRepoInput =>
  parseGithubPrUrl(repoUrl) ?? { repoUrl: repoUrl.trim() }
