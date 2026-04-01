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

export type GithubRepo = {
  readonly owner: string
  readonly repo: string
}

const stripQueryHash = (value: string): string => {
  const queryIndex = value.indexOf("?")
  const hashIndex = value.indexOf("#")
  const indices = [queryIndex, hashIndex].filter((index) => index >= 0)
  if (indices.length === 0) {
    return value
  }
  const cutIndex = Math.min(...indices)
  return value.slice(0, cutIndex)
}

const splitGithubPath = (input: string): ReadonlyArray<string> | null => {
  const trimmed = input.trim()
  const httpsPrefix = "https://github.com/"
  const sshPrefix = "ssh://git@github.com/"
  const gitPrefix = "git@github.com:"
  let rest: string | null = null
  if (trimmed.startsWith(httpsPrefix)) {
    rest = trimmed.slice(httpsPrefix.length)
  } else if (trimmed.startsWith(sshPrefix)) {
    rest = trimmed.slice(sshPrefix.length)
  } else if (trimmed.startsWith(gitPrefix)) {
    rest = trimmed.slice(gitPrefix.length)
  }
  if (rest === null) {
    return null
  }
  const cleaned = trimRightChar(stripQueryHash(rest), "/")
  if (cleaned.length === 0) {
    return []
  }
  return cleaned.split("/").filter((part) => part.length > 0)
}

// CHANGE: parse GitHub owner/repo from common URL formats
// WHY: enable auto-fork logic without relying on slugified paths
// QUOTE(ТЗ): "Сразу на issues и он бы делал форк репы если это надо"
// REF: user-request-2026-02-05-issues-fork
// SOURCE: n/a
// FORMAT THEOREM: ∀u: github(u) → repo(u) = {owner, repo}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returns null for non-GitHub inputs
// COMPLEXITY: O(n) where n = |input|
export const parseGithubRepoUrl = (input: string): GithubRepo | null => {
  const parts = splitGithubPath(input)
  if (!parts || parts.length < 2) {
    return null
  }

  const owner = parts[0]?.trim()
  const repoRaw = parts[1]?.trim()
  if (!owner || !repoRaw) {
    return null
  }

  const repo = stripGitSuffix(repoRaw)
  return { owner, repo }
}

export type ResolvedRepoInput = {
  readonly repoUrl: string
  readonly repoRef?: string
  readonly workspaceSuffix?: string
}

type GithubRefParts = {
  readonly owner: string
  readonly repoRaw: string
  readonly marker: string
  readonly ref: string
}

const readGithubPart = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

const parseGithubRefParts = (input: string): GithubRefParts | null => {
  const parts = splitGithubPath(input)
  if (!parts || parts.length < 4) {
    return null
  }
  const owner = readGithubPart(parts[0])
  const repoRaw = readGithubPart(parts[1])
  const markerRaw = readGithubPart(parts[2])
  const ref = readGithubPart(parts[3])
  if (!owner || !repoRaw || !markerRaw || !ref) {
    return null
  }
  return { owner, repoRaw, marker: markerRaw.toLowerCase(), ref }
}

const parseGithubPrUrl = (input: string): ResolvedRepoInput | null => {
  const parsed = parseGithubRefParts(input)
  if (!parsed || parsed.marker !== "pull") {
    return null
  }

  const repo = stripGitSuffix(parsed.repoRaw)
  const workspaceSuffix = `pr-${slugify(parsed.ref)}`
  return {
    repoUrl: `https://github.com/${parsed.owner}/${repo}.git`,
    repoRef: `refs/pull/${parsed.ref}/head`,
    workspaceSuffix
  }
}

// CHANGE: normalize GitHub tree/blob URLs into repo + ref
// WHY: allow docker-git clone to accept branch URLs like /tree/<branch>
// QUOTE(ТЗ): "вызови --force на https://github.com/agiens/crm/tree/vova-fork"
// REF: user-request-2026-02-10-github-tree-url
// SOURCE: n/a
// FORMAT THEOREM: ∀u: tree(u) → repo(u)=git(u) ∧ ref(u)=branch(u)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: ignores additional path segments after the ref
// COMPLEXITY: O(n) where n = |url|
const parseGithubTreeUrl = (input: string): ResolvedRepoInput | null => {
  const parsed = parseGithubRefParts(input)
  if (!parsed || (parsed.marker !== "tree" && parsed.marker !== "blob")) {
    return null
  }

  const repo = stripGitSuffix(parsed.repoRaw)
  return { repoUrl: `https://github.com/${parsed.owner}/${repo}.git`, repoRef: parsed.ref }
}

// CHANGE: normalize GitHub issue URLs into repo URLs
// WHY: allow docker-git clone to accept issue links directly
// QUOTE(ТЗ): "Сразу на issues"
// REF: user-request-2026-02-05-issues
// SOURCE: n/a
// FORMAT THEOREM: ∀u: issue(u) → repo(u)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: issue URL yields repoUrl + deterministic issue branch
// COMPLEXITY: O(n) where n = |url|
const parseGithubIssueUrl = (input: string): ResolvedRepoInput | null => {
  const parsed = parseGithubRefParts(input)
  if (!parsed || parsed.marker !== "issues") {
    return null
  }

  const repo = stripGitSuffix(parsed.repoRaw)
  const workspaceSuffix = `issue-${slugify(parsed.ref)}`
  return {
    repoUrl: `https://github.com/${parsed.owner}/${repo}.git`,
    repoRef: workspaceSuffix,
    workspaceSuffix
  }
}

// CHANGE: normalize repo input and PR/issue URLs into repo + ref
// WHY: allow cloning GitHub PR links and issue links directly
// QUOTE(ТЗ): "клонировть по cсылке на PR" | "Сразу на issues"
// REF: user-request-2026-01-28-pr | user-request-2026-02-05-issues
// SOURCE: n/a
// FORMAT THEOREM: forall url: resolve(url) -> deterministic(url, ref)
// PURITY: CORE
// EFFECT: Effect<ResolvedRepoInput, never, never>
// INVARIANT: PR URL yields repoUrl + refs/pull/<id>/head
// COMPLEXITY: O(n) where n = |url|
export const resolveRepoInput = (repoUrl: string): ResolvedRepoInput =>
  parseGithubPrUrl(repoUrl)
    ?? parseGithubTreeUrl(repoUrl)
    ?? parseGithubIssueUrl(repoUrl)
    ?? { repoUrl: repoUrl.trim() }
