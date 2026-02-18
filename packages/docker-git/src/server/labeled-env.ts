import { parseEnvEntries } from "./core/env.js"

export interface LabeledEnvEntry {
  readonly key: string
  readonly label: string
  readonly value: string
}

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

const buildLabelPrefix = (baseKey: string): string => `${baseKey}__`

const resolveLabelFromKey = (
  baseKey: string,
  key: string
): string | null => {
  if (key === baseKey) {
    return "default"
  }
  const prefix = buildLabelPrefix(baseKey)
  if (!key.startsWith(prefix)) {
    return null
  }
  const rawLabel = key.slice(prefix.length)
  const normalized = normalizeLabel(rawLabel)
  return normalized.length > 0 ? normalized : null
}

// CHANGE: build a normalized env key for labeled secrets
// WHY: keep key resolution deterministic across services (Git / Claude / etc)
// QUOTE(ТЗ): "реализовать систему где я могу задавать N множества ключей"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall b,l: key(b,l) = b | b__LABEL
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: empty/default labels resolve to the base key
// COMPLEXITY: O(|l|)
export const buildLabeledEnvKey = (baseKey: string, label: string): string => {
  const normalized = normalizeLabel(label)
  if (normalized.length === 0 || normalized === "DEFAULT") {
    return baseKey
  }
  return `${buildLabelPrefix(baseKey)}${normalized}`
}

// CHANGE: list labeled env entries for a base key
// WHY: support multiple credential sets under one service namespace
// QUOTE(ТЗ): "задавать N множества ключей"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall e,b: list(e,b) subset assignments(e)
// PURITY: CORE
// EFFECT: Effect<ReadonlyArray<LabeledEnvEntry>, never, never>
// INVARIANT: only non-empty values are returned
// COMPLEXITY: O(n) where n = |entries|
export const listLabeledEnvEntries = (
  envText: string,
  baseKey: string
): ReadonlyArray<LabeledEnvEntry> =>
  parseEnvEntries(envText)
    .flatMap((entry) => {
      const label = resolveLabelFromKey(baseKey, entry.key)
      if (label === null) {
        return []
      }
      return [{
        key: entry.key,
        label,
        value: entry.value
      }]
    })
    .filter((entry) => entry.value.trim().length > 0)

// CHANGE: find a labeled entry by label
// WHY: map UI-selected labels to stored env values
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall s,l: find(s,l) -> entry(l) | null
// PURITY: CORE
// EFFECT: Effect<LabeledEnvEntry | null, never, never>
// INVARIANT: label normalization matches buildLabeledEnvKey
// COMPLEXITY: O(n) where n = |entries|
export const findLabeledEnvEntryByLabel = (
  entries: ReadonlyArray<LabeledEnvEntry>,
  baseKey: string,
  label: string
): LabeledEnvEntry | null => {
  const key = buildLabeledEnvKey(baseKey, label)
  return entries.find((entry) => entry.key === key) ?? null
}

// CHANGE: resolve label for a concrete secret value
// WHY: show active labeled profile in project settings
// QUOTE(ТЗ): "возможность выбора"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall s,v: resolve(s,v) -> label(v) | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: exact value match
// COMPLEXITY: O(n) where n = |entries|
export const resolveLabeledEnvLabelForValue = (
  entries: ReadonlyArray<LabeledEnvEntry>,
  value: string
): string | null => {
  const match = entries.find((entry) => entry.value === value)
  return match ? match.label : null
}
