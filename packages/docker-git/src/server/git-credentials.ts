import { findEnvValue } from "./core/env.js"
import {
  type LabeledEnvEntry,
  findLabeledEnvEntryByLabel,
  listLabeledEnvEntries,
  resolveLabeledEnvLabelForValue
} from "./labeled-env.js"

export interface GitCredentialEntry {
  readonly label: string
  readonly token: string
  readonly user: string
}

const gitTokenBaseKey = "GIT_AUTH_TOKEN"
const gitUserBaseKey = "GIT_AUTH_USER"
const gitLabelKey = "GIT_AUTH_LABEL"
const defaultGitUser = "x-access-token"

const buildGitUserMap = (envText: string): ReadonlyMap<string, string> =>
  new Map(
    listLabeledEnvEntries(envText, gitUserBaseKey).map((entry) => [entry.label, entry.value] as const)
  )

const toGitCredential = (
  tokenEntry: LabeledEnvEntry,
  users: ReadonlyMap<string, string>
): GitCredentialEntry => {
  const defaultUser = users.get("default") ?? defaultGitUser
  const user = users.get(tokenEntry.label) ?? defaultUser
  return {
    label: tokenEntry.label,
    token: tokenEntry.value,
    user
  }
}

// CHANGE: list labeled Git credentials from env text
// WHY: enable selecting one of many Git credential sets per project
// QUOTE(ТЗ): "возможность выбора нескольки GH, GIT ключей"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall env: list(env) -> credentials(env)
// PURITY: CORE
// EFFECT: Effect<ReadonlyArray<GitCredentialEntry>, never, never>
// INVARIANT: token values are non-empty
// COMPLEXITY: O(n) where n = |entries|
export const listGitCredentials = (envText: string): ReadonlyArray<GitCredentialEntry> => {
  const tokens = listLabeledEnvEntries(envText, gitTokenBaseKey)
  const users = buildGitUserMap(envText)
  return tokens.map((entry) => toGitCredential(entry, users))
}

// CHANGE: find Git credential by label
// WHY: map selected label from UI to token+user pair
// QUOTE(ТЗ): "реализовать систему где я могу задавать N множества ключей"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall c,l: find(c,l) -> credential(l) | null
// PURITY: CORE
// EFFECT: Effect<GitCredentialEntry | null, never, never>
// INVARIANT: label normalization matches key normalization
// COMPLEXITY: O(n) where n = |credentials|
export const findGitCredentialByLabel = (
  envText: string,
  label: string
): GitCredentialEntry | null => {
  const tokenEntries = listLabeledEnvEntries(envText, gitTokenBaseKey)
  const token = findLabeledEnvEntryByLabel(tokenEntries, gitTokenBaseKey, label)
  if (token === null) {
    return null
  }
  const users = buildGitUserMap(envText)
  return toGitCredential(token, users)
}

// CHANGE: resolve active Git token from project env
// WHY: show currently connected Git credential in project settings
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall env: token(env) -> string | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: empty values map to null
// COMPLEXITY: O(n) where n = |entries|
export const resolveProjectGitToken = (envText: string): string | null =>
  findEnvValue(envText, gitTokenBaseKey)

// CHANGE: resolve active Git label override from project env
// WHY: preserve explicit label choice when token value can overlap
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall env: label(env) -> string | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: empty values map to null
// COMPLEXITY: O(n) where n = |entries|
export const resolveProjectGitLabel = (envText: string): string | null =>
  findEnvValue(envText, gitLabelKey)

// CHANGE: resolve Git label by token value
// WHY: show inferred active label when project label key is absent
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall c,t: label(c,t) -> string | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: exact token match
// COMPLEXITY: O(n) where n = |credentials|
export const resolveGitLabelForToken = (
  envText: string,
  token: string
): string | null => {
  const entries = listLabeledEnvEntries(envText, gitTokenBaseKey)
  return resolveLabeledEnvLabelForValue(entries, token)
}

// CHANGE: expose env key used to persist project Git label
// WHY: keep route handlers and helpers consistent
// QUOTE(ТЗ): "реализовать систему выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall _: key = constant
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: constant key
// COMPLEXITY: O(1)
export const projectGitLabelKey = gitLabelKey
