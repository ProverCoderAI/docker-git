import { findEnvValue } from "./core/env.js"
import {
  findLabeledEnvEntryByLabel,
  listLabeledEnvEntries,
  resolveLabeledEnvLabelForValue
} from "./labeled-env.js"

export interface ClaudeApiKeyEntry {
  readonly label: string
  readonly apiKey: string
}

const claudeApiKeyBase = "ANTHROPIC_API_KEY"
const claudeLabelKey = "CLAUDE_AUTH_LABEL"

// CHANGE: list labeled Claude API keys from env text
// WHY: support multiple Claude Code profiles in integrations
// QUOTE(ТЗ): "N множества ключей ... Claude Code"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall env: list(env) -> keys(env)
// PURITY: CORE
// EFFECT: Effect<ReadonlyArray<ClaudeApiKeyEntry>, never, never>
// INVARIANT: only non-empty keys are returned
// COMPLEXITY: O(n) where n = |entries|
export const listClaudeApiKeys = (envText: string): ReadonlyArray<ClaudeApiKeyEntry> =>
  listLabeledEnvEntries(envText, claudeApiKeyBase).map((entry) => ({
    label: entry.label,
    apiKey: entry.value
  }))

// CHANGE: find Claude API key by label
// WHY: map selected profile label to stored API key
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall env,l: find(env,l) -> key(l) | null
// PURITY: CORE
// EFFECT: Effect<ClaudeApiKeyEntry | null, never, never>
// INVARIANT: label normalization is deterministic
// COMPLEXITY: O(n) where n = |entries|
export const findClaudeApiKeyByLabel = (
  envText: string,
  label: string
): ClaudeApiKeyEntry | null => {
  const entries = listLabeledEnvEntries(envText, claudeApiKeyBase)
  const matched = findLabeledEnvEntryByLabel(entries, claudeApiKeyBase, label)
  if (matched === null) {
    return null
  }
  return {
    label: matched.label,
    apiKey: matched.value
  }
}

// CHANGE: resolve active Claude API key from project env
// WHY: show whether project is attached to a Claude profile
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall env: key(env) -> string | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: empty values map to null
// COMPLEXITY: O(n) where n = |entries|
export const resolveProjectClaudeApiKey = (envText: string): string | null =>
  findEnvValue(envText, claudeApiKeyBase)

// CHANGE: resolve active Claude label override from project env
// WHY: preserve explicit label selection across equivalent keys
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall env: label(env) -> string | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: empty values map to null
// COMPLEXITY: O(n) where n = |entries|
export const resolveProjectClaudeLabel = (envText: string): string | null =>
  findEnvValue(envText, claudeLabelKey)

// CHANGE: resolve Claude label for a raw API key value
// WHY: infer current profile when explicit project label is missing
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall env,v: label(env,v) -> string | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: exact value match
// COMPLEXITY: O(n) where n = |entries|
export const resolveClaudeLabelForApiKey = (
  envText: string,
  apiKey: string
): string | null => {
  const entries = listLabeledEnvEntries(envText, claudeApiKeyBase)
  return resolveLabeledEnvLabelForValue(entries, apiKey)
}

// CHANGE: expose env key used to persist project Claude label
// WHY: keep handlers aligned on a single key
// QUOTE(ТЗ): "реализовать систему выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall _: key = constant
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: constant key
// COMPLEXITY: O(1)
export const projectClaudeLabelKey = claudeLabelKey
