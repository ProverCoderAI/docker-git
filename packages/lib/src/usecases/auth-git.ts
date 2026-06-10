import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

import type { AuthGitLoginCommand, AuthGitLogoutCommand, AuthGitStatusCommand } from "../core/domain.js"
import { trimLeftChar, trimRightChar } from "../core/strings.js"
import { AuthError } from "../shell/errors.js"
import { ensureEnvFile, parseEnvEntries, readEnvText, removeEnvKey, upsertEnvKey } from "./env-file.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"
import { autoSyncState } from "./state-repo.js"

// CHANGE: add generic per-host git auth usecase
// WHY: issue #368 wants git connections to providers other than github/gitlab
// QUOTE(ТЗ): "реализовать возможность добавлять git подключения отличных от gitlab, github"
// REF: issue-368
// SOURCE: https://git-scm.com/docs/gitcredentials
// FORMAT THEOREM: forall host: persist(host, token) -> GIT_AUTH_TOKEN__<HOST_KEY> set
// PURITY: CORE (helpers) / SHELL (Effects)
// EFFECT: Effect<void, AuthError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: env keys mirror the in-container credential helper's host normalization
// COMPLEXITY: O(n) where n = |env entries|

type GitFsRuntime = FileSystem | Path
type GitRuntime = FileSystem | Path | CommandExecutor

const tokenKey = "GIT_AUTH_TOKEN"
const tokenPrefix = "GIT_AUTH_TOKEN__"
const userKey = "GIT_AUTH_USER"
const userPrefix = "GIT_AUTH_USER__"

const defaultGitUser = "x-access-token"

export type GitConnectionEntry = {
  readonly host: string
  readonly token: string
  readonly user: string
}

// CHANGE: reduce a host (or full URL) to its bare host[:port] segment
// WHY: only the host portion participates in the credential-helper env key
// QUOTE(ТЗ): "git подключения отличных от gitlab, github"
// REF: issue-368
// SOURCE: https://git-scm.com/docs/gitcredentials (host includes port when specified)
// FORMAT THEOREM: stripGitHostPath("https://user@h/x") = "h"
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: scheme, credentials and path are removed; the rest is preserved verbatim
// COMPLEXITY: O(n) where n = |value|
const stripGitHostPath = (value: string): string => {
  const withoutScheme = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u, "")
  const withoutCredentials = withoutScheme.replace(/^[^@/]+@/u, "")
  const slashIndex = withoutCredentials.indexOf("/")
  return slashIndex === -1 ? withoutCredentials : withoutCredentials.slice(0, slashIndex)
}

// CHANGE: normalize a host (or full URL) into the credential-helper env key suffix
// WHY: CLI/web persistence must match the in-container helper resolution exactly
// QUOTE(ТЗ): "git подключения отличных от gitlab, github"
// REF: issue-368
// SOURCE: https://git-scm.com/docs/gitcredentials (host includes port when specified)
// FORMAT THEOREM: normalizeGitHost("https://git.example.com/x") = "GIT_EXAMPLE_COM"
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: uppercase, non-alphanumeric -> "_", trimmed of leading/trailing "_"
// COMPLEXITY: O(n) where n = |value|
export const normalizeGitHost = (value: string | null): string => {
  const hostOnly = stripGitHostPath((value ?? "").trim())
  const normalized = hostOnly.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, "_")
  return trimRightChar(trimLeftChar(normalized, "_"), "_")
}

export const buildGitTokenKey = (host: string): string => {
  const normalized = normalizeGitHost(host)
  return normalized.length === 0 ? tokenKey : `${tokenPrefix}${normalized}`
}

export const buildGitUserKey = (host: string): string => {
  const normalized = normalizeGitHost(host)
  return normalized.length === 0 ? userKey : `${userPrefix}${normalized}`
}

export const gitHostFromKey = (key: string): string => {
  if (key.startsWith(tokenPrefix)) {
    return key.slice(tokenPrefix.length)
  }
  if (key.startsWith(userPrefix)) {
    return key.slice(userPrefix.length)
  }
  return "default"
}

export const listGitConnections = (envText: string): ReadonlyArray<GitConnectionEntry> => {
  const entries = parseEnvEntries(envText)
  const userByHost = new Map<string, string>()
  for (const entry of entries) {
    if (entry.key === userKey || entry.key.startsWith(userPrefix)) {
      userByHost.set(gitHostFromKey(entry.key), entry.value)
    }
  }
  return entries
    .filter((entry) => entry.key === tokenKey || entry.key.startsWith(tokenPrefix))
    .filter((entry) => entry.value.trim().length > 0)
    .map((entry) => {
      const host = gitHostFromKey(entry.key)
      return { host, token: entry.value, user: userByHost.get(host) ?? "" }
    })
}

type GitEnvContext = {
  readonly host: string
  readonly fs: FileSystem
  readonly envPath: string
  readonly current: string
}

// CHANGE: share the host-validated env prologue between login and logout
// WHY: both mutators normalize the host, resolve and read the env file identically
// QUOTE(ТЗ): "реализовать возможность добавлять git подключения отличных от gitlab, github"
// REF: issue-368
// SOURCE: n/a
// FORMAT THEOREM: withGitHostEnv(cmd, use) fails when host is empty, else runs use over the read env
// PURITY: SHELL
// EFFECT: Effect<A, AuthError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: an empty host always yields a typed AuthError before any write
// COMPLEXITY: O(n) where n = |env entries|
const withGitHostEnv = <A>(
  command: { readonly host: string; readonly envGlobalPath: string },
  use: (context: GitEnvContext) => Effect.Effect<A, AuthError | PlatformError, GitRuntime>
): Effect.Effect<A, AuthError | PlatformError, GitRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      const host = normalizeGitHost(command.host)
      if (host.length === 0) {
        return yield* _(Effect.fail(new AuthError({ message: "Git host is required (use --host <host>)." })))
      }
      const envPath = resolvePathFromCwd(path, cwd, command.envGlobalPath)
      yield* _(ensureEnvFile(fs, path, envPath))
      const current = yield* _(readEnvText(fs, envPath))
      return yield* _(use({ host, fs, envPath, current }))
    })
  )

export const authGitLogin = (
  command: AuthGitLoginCommand
): Effect.Effect<void, AuthError | PlatformError, GitRuntime> =>
  withGitHostEnv(command, ({ current, envPath, fs, host }) =>
    Effect.gen(function*(_) {
      const token = command.token?.trim() ?? ""
      if (token.length === 0) {
        return yield* _(Effect.fail(new AuthError({ message: "Git token is required (use --token <token>)." })))
      }
      const user = command.user?.trim() ?? ""
      const nextText = upsertEnvKey(
        upsertEnvKey(current, buildGitTokenKey(command.host), token),
        buildGitUserKey(command.host),
        user.length > 0 ? user : defaultGitUser
      )
      yield* _(fs.writeFileString(envPath, nextText))
      yield* _(Effect.log(`Git token stored (${host}) in ${envPath}`))
      yield* _(autoSyncState(`chore(state): auth git ${host}`))
    }))

export const authGitStatus = (
  command: AuthGitStatusCommand
): Effect.Effect<ReadonlyArray<GitConnectionEntry>, PlatformError, GitFsRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      const envPath = resolvePathFromCwd(path, cwd, command.envGlobalPath)
      const current = yield* _(readEnvText(fs, envPath))
      const connections = listGitConnections(current)
      if (connections.length === 0) {
        yield* _(Effect.log(`No generic git connections in ${envPath}.`))
      } else {
        const lines = connections.map((entry) => `- ${entry.host} (user: ${entry.user || defaultGitUser})`)
        yield* _(Effect.log([`Git connections (${connections.length}):`, ...lines].join("\n")))
      }
      return connections
    })
  )

export const authGitLogout = (
  command: AuthGitLogoutCommand
): Effect.Effect<void, AuthError | PlatformError, GitRuntime> =>
  withGitHostEnv(command, ({ current, envPath, fs, host }) =>
    Effect.gen(function*(_) {
      const nextText = removeEnvKey(
        removeEnvKey(current, buildGitTokenKey(command.host)),
        buildGitUserKey(command.host)
      )
      yield* _(fs.writeFileString(envPath, nextText))
      yield* _(Effect.log(`Git token removed (${host}) from ${envPath}`))
      yield* _(autoSyncState(`chore(state): auth git logout ${host}`))
    }))
