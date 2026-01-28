import { Effect, Either } from "effect"
import * as Data from "effect/Data"
import * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"

import { parseEnvEntries } from "./core/env.js"

export interface GithubTokenEntry {
  readonly key: string
  readonly label: string
  readonly token: string
}

export interface GithubAccount {
  readonly label: string
  readonly login: string
}

export class GithubAccountError extends Data.TaggedError("GithubAccountError")<{
  readonly label: string
  readonly message: string
}> {}

const GithubUserSchema = Schema.Struct({
  login: Schema.String
})

const decodeGithubUser = (
  label: string,
  input: unknown
): Effect.Effect<{ readonly login: string }, GithubAccountError> =>
  Either.match(ParseResult.decodeUnknownEither(GithubUserSchema)(input), {
    onLeft: (issue) =>
      Effect.fail(
        new GithubAccountError({
          label,
          message: ParseResult.TreeFormatter.formatIssueSync(issue)
        })
      ),
    onRight: (value) => Effect.succeed(value)
  })

const tokenKey = "GITHUB_TOKEN"
const tokenPrefix = "GITHUB_TOKEN__"
const projectTokenKeys: ReadonlyArray<string> = ["GIT_AUTH_TOKEN", "GITHUB_TOKEN"]

const normalizeLabel = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ""
  }
  const normalized = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
  return normalized.length > 0 ? normalized : ""
}

// CHANGE: treat "default" label as the base GitHub token key
// WHY: keep UI label stable while resolving to GITHUB_TOKEN
// QUOTE(ТЗ): "выбираю гитхаб аккаунт для определённого докера"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall l: l = "default" -> key(l) = GITHUB_TOKEN
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: "default" and empty labels map to the same key
// COMPLEXITY: O(1)
export const buildGithubTokenKey = (label: string): string => {
  const normalized = normalizeLabel(label)
  if (normalized === "DEFAULT") {
    return tokenKey
  }
  return normalized.length === 0 ? tokenKey : `${tokenPrefix}${normalized}`
}

const labelFromKey = (key: string): string =>
  key.startsWith(tokenPrefix) ? key.slice(tokenPrefix.length) : "default"

// CHANGE: find a GitHub token entry by label
// WHY: allow selecting a specific account for a project
// QUOTE(ТЗ): "я могу несколько аккаунтов подключать"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall label: find(label) -> entry(label) | null
// PURITY: CORE
// EFFECT: Effect<GithubTokenEntry | null, never, never>
// INVARIANT: label normalization matches buildGithubTokenKey
// COMPLEXITY: O(n) where n = |tokens|
export const findGithubTokenByLabel = (
  tokens: ReadonlyArray<GithubTokenEntry>,
  label: string
): GithubTokenEntry | null => {
  const key = buildGithubTokenKey(label)
  return tokens.find((entry) => entry.key === key) ?? null
}

// CHANGE: resolve active GitHub token from a project env file
// WHY: display which account is wired to a project
// QUOTE(ТЗ): "должен быть отображён что за аккаунт подключён"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall env: resolve(env) = token(env) | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: prefers GIT_AUTH_TOKEN over GITHUB_TOKEN
// COMPLEXITY: O(n) where n = |entries|
export const resolveProjectGithubToken = (envText: string): string | null => {
  const entries = parseEnvEntries(envText)
  for (const key of projectTokenKeys) {
    const entry = entries.find((item) => item.key === key)
    if (entry && entry.value.trim().length > 0) {
      return entry.value
    }
  }
  return null
}

// CHANGE: match a token value to a known label
// WHY: show connected account label without leaking secrets
// QUOTE(ТЗ): "должен быть отображён что за аккаунт подключён"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall t: match(t) -> label(t) | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: exact token match
// COMPLEXITY: O(n) where n = |tokens|
export const resolveGithubLabelForToken = (
  tokens: ReadonlyArray<GithubTokenEntry>,
  token: string
): string | null => {
  const match = tokens.find((entry) => entry.token === token)
  return match ? match.label : null
}

// CHANGE: list GitHub tokens from env text
// WHY: support multiple accounts in the orchestrator
// QUOTE(ТЗ): "я могу несколько аккаунтов подключать"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s: tokens(s) = subset(env(s))
// PURITY: CORE
// EFFECT: Effect<ReadonlyArray<GithubTokenEntry>, never, never>
// INVARIANT: returns only non-empty tokens
// COMPLEXITY: O(n) where n = |entries|
export const listGithubTokens = (envText: string): ReadonlyArray<GithubTokenEntry> =>
  parseEnvEntries(envText)
    .filter((entry) =>
      entry.key === tokenKey || entry.key.startsWith(tokenPrefix)
    )
    .map((entry) => ({
      key: entry.key,
      label: labelFromKey(entry.key),
      token: entry.value
    }))
    .filter((entry) => entry.token.trim().length > 0)

// CHANGE: resolve GitHub account identity for a token
// WHY: show which account is connected in the UI
// QUOTE(ТЗ): "должен быть отображён что за аккаунт подключён"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall t: fetch(t) -> login(t)
// PURITY: SHELL
// EFFECT: Effect<GithubAccount, GithubAccountError>
// INVARIANT: no tokens are logged
// COMPLEXITY: O(1)
export const fetchGithubAccount = (
  entry: GithubTokenEntry
): Effect.Effect<GithubAccount, GithubAccountError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch("https://api.github.com/user", {
        method: "GET",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${entry.token}`,
          "User-Agent": "docker-git"
        }
      })
      if (!response.ok) {
        const body = await response.text()
        throw new Error(`GitHub response ${response.status}: ${body}`)
      }
      return response.json()
    },
    catch: (error) =>
      new GithubAccountError({
        label: entry.label,
        message: error instanceof Error ? error.message : String(error)
      })
  }).pipe(
    Effect.flatMap((json) => decodeGithubUser(entry.label, json)),
    Effect.map((user) => ({
      label: entry.label,
      login: user.login
    }))
  )
