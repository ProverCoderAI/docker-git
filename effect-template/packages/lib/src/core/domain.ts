import { Either, Match } from "effect"

import { trimLeftChar, trimRightChar } from "./strings.js"

export interface TemplateConfig {
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly repoUrl: string
  readonly repoRef: string
  readonly targetDir: string
  readonly volumeName: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
  readonly pnpmVersion: string
}

export interface ProjectConfig {
  readonly schemaVersion: 1
  readonly template: TemplateConfig
}

export interface CreateCommand {
  readonly _tag: "Create"
  readonly config: TemplateConfig
  readonly outDir: string
  readonly runUp: boolean
  readonly force: boolean
  readonly waitForClone: boolean
}

export interface MenuCommand {
  readonly _tag: "Menu"
}

export interface HelpCommand {
  readonly _tag: "Help"
  readonly message: string
}

export interface StatusCommand {
  readonly _tag: "Status"
}

export type Command = CreateCommand | MenuCommand | HelpCommand | StatusCommand

export type MenuAction =
  | { readonly _tag: "Create" }
  | { readonly _tag: "Info" }
  | { readonly _tag: "Up" }
  | { readonly _tag: "Status" }
  | { readonly _tag: "Logs" }
  | { readonly _tag: "Down" }
  | { readonly _tag: "Quit" }

export type ParseError =
  | { readonly _tag: "UnknownCommand"; readonly command: string }
  | { readonly _tag: "UnknownOption"; readonly option: string }
  | { readonly _tag: "MissingOptionValue"; readonly option: string }
  | { readonly _tag: "MissingRequiredOption"; readonly option: string }
  | { readonly _tag: "InvalidOption"; readonly option: string; readonly reason: string }
  | { readonly _tag: "UnexpectedArgument"; readonly value: string }

export const defaultTemplateConfig = {
  containerName: "dev-ssh",
  serviceName: "dev",
  sshUser: "dev",
  sshPort: 2222,
  repoRef: "main",
  targetDir: "/home/dev/app",
  volumeName: "dev_home",
  authorizedKeysPath: "./authorized_keys",
  envGlobalPath: "./.orch/env/global.env",
  envProjectPath: "./.orch/env/project.env",
  codexAuthPath: "./.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  pnpmVersion: "10.27.0"
}

export const usageText = `docker-git menu
docker-git create --repo-url <url> [options]
docker-git clone <url> [options]
docker-git ps

Commands:
  menu                Interactive menu (default when no args)
  create, init        Generate docker development environment
  clone               Create + run container and clone repo
  ps, status          Show docker compose status for all docker-git projects

Options:
  --repo-ref <ref>          Git ref/branch (default: main)
  --branch, -b <ref>        Alias for --repo-ref
  --target-dir <path>       Target dir inside container (create default: /home/dev/app, clone default: /home/dev/<org>/<repo>)
  --ssh-port <port>         Local SSH port (default: 2222)
  --ssh-user <user>         SSH user inside container (default: dev)
  --container-name <name>   Docker container name (default: dg-<repo>)
  --service-name <name>     Compose service name (default: dg-<repo>)
  --volume-name <name>      Docker volume name (default: dg-<repo>-home)
  --secrets-root <path>     Host root for shared secrets (default: n/a)
  --authorized-keys <path>  Host path to authorized_keys (default: ./authorized_keys)
  --env-global <path>       Host path to shared env file (default: ./.orch/env/global.env)
  --env-project <path>      Host path to project env file (default: ./.orch/env/project.env)
  --codex-auth <path>       Host path for Codex auth cache (default: ./.orch/auth/codex)
  --codex-home <path>       Container path for Codex auth (default: /home/dev/.codex)
  --out-dir <path>          Output directory (create default: ., clone default: .docker-git/<org>/<repo>)
  --up | --no-up            Run docker compose up after init (default: --up)
  --force                   Overwrite existing files
  -h, --help                Show this help
`

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

const normalizeMenuInput = (input: string): string => input.trim().toLowerCase()

const createAliases = new Set(["1", "create", "c"])
const infoAliases = new Set(["2", "info", "i"])
const upAliases = new Set(["3", "up", "u", "start"])
const statusAliases = new Set(["4", "status", "ps"])
const logsAliases = new Set(["5", "logs", "log", "l"])
const downAliases = new Set(["6", "down", "stop", "d"])
const quitAliases = new Set(["0", "quit", "q", "exit"])

const resolveMenuAction = (normalized: string): MenuAction | undefined => {
  if (createAliases.has(normalized)) {
    return { _tag: "Create" }
  }
  if (infoAliases.has(normalized)) {
    return { _tag: "Info" }
  }
  if (upAliases.has(normalized)) {
    return { _tag: "Up" }
  }
  if (statusAliases.has(normalized)) {
    return { _tag: "Status" }
  }
  if (logsAliases.has(normalized)) {
    return { _tag: "Logs" }
  }
  if (downAliases.has(normalized)) {
    return { _tag: "Down" }
  }
  if (quitAliases.has(normalized)) {
    return { _tag: "Quit" }
  }
  return undefined
}

// CHANGE: decode interactive menu input into a typed action
// WHY: keep menu parsing pure and reusable across shells
// QUOTE(ТЗ): "Хочу что бы открылось менюшка"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall s: parseMenu(s) = a -> deterministic(a)
// PURITY: CORE
// EFFECT: Effect<MenuAction, ParseError, never>
// INVARIANT: unknown input maps to InvalidOption
// COMPLEXITY: O(1)
export const parseMenuSelection = (input: string): Either.Either<MenuAction, ParseError> => {
  const normalized = normalizeMenuInput(input)

  if (normalized.length === 0) {
    return Either.left({
      _tag: "InvalidOption",
      option: "menu",
      reason: "empty selection"
    })
  }

  const action = resolveMenuAction(normalized)
  if (action === undefined) {
    return Either.left({
      _tag: "InvalidOption",
      option: "menu",
      reason: `unknown selection: ${input}`
    })
  }

  return Either.right(action)
}

// CHANGE: normalize parse errors into user-facing messages
// WHY: keep formatting deterministic and centralized
// QUOTE(ТЗ): "Надо написать CLI команду"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall e: format(e) = s -> deterministic(s)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: each ParseError maps to exactly one message
// COMPLEXITY: O(1)
export const formatParseError = (error: ParseError): string =>
  Match.value(error).pipe(
    Match.when({ _tag: "UnknownCommand" }, ({ command }) => `Unknown command: ${command}`),
    Match.when({ _tag: "UnknownOption" }, ({ option }) => `Unknown option: ${option}`),
    Match.when({ _tag: "MissingOptionValue" }, ({ option }) => `Missing value for option: ${option}`),
    Match.when({ _tag: "MissingRequiredOption" }, ({ option }) => `Missing required option: ${option}`),
    Match.when({ _tag: "InvalidOption" }, ({ option, reason }) => `Invalid option ${option}: ${reason}`),
    Match.when({ _tag: "UnexpectedArgument" }, ({ value }) => `Unexpected argument: ${value}`),
    Match.exhaustive
  )
