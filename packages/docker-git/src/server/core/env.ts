// CHANGE: normalize env file contents for deterministic writes
// WHY: keep env persistence stable across platforms and edits
// QUOTE(ТЗ): "удобную настройку ENV"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s: normalize(s) endsWith("\n")
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: output uses LF line endings
// COMPLEXITY: O(n) where n = |s|
const envAssignmentPattern = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/

const splitLines = (input: string): ReadonlyArray<string> =>
  input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")

const joinLines = (lines: ReadonlyArray<string>): string => lines.join("\n")

const stripQuotes = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length < 2) {
    return trimmed
  }
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

// CHANGE: normalize env file contents for deterministic writes
// WHY: keep env persistence stable across platforms and edits
// QUOTE(ТЗ): "удобную настройку ENV"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s: normalize(s) endsWith("\n")
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: output uses LF line endings
// COMPLEXITY: O(n) where n = |s|
export const normalizeEnvText = (input: string): string => {
  const normalized = joinLines(splitLines(input))
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`
}

const extractEnvAssignment = (line: string): { readonly key: string; readonly value: string } | null => {
  const match = envAssignmentPattern.exec(line)
  if (!match || !match[1]) {
    return null
  }
  return { key: match[1], value: match[2] ?? "" }
}

export interface EnvEntry {
  readonly key: string
  readonly value: string
}

// CHANGE: parse env file into key/value entries
// WHY: enable orchestration of multiple credentials
// QUOTE(ТЗ): "я могу несколько аккаунтов подключать"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s: parse(s) -> entries(s)
// PURITY: CORE
// EFFECT: Effect<ReadonlyArray<EnvEntry>, never, never>
// INVARIANT: ignores empty and commented lines
// COMPLEXITY: O(n) where n = |lines|
export const parseEnvEntries = (input: string): ReadonlyArray<EnvEntry> => {
  const entries: Array<EnvEntry> = []
  for (const line of splitLines(input)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue
    }
    const assignment = extractEnvAssignment(line)
    if (assignment) {
      entries.push({
        key: assignment.key,
        value: stripQuotes(assignment.value)
      })
    }
  }
  return entries
}

// CHANGE: detect whether an env file sets a given key
// WHY: show integration connection status without leaking secrets
// QUOTE(ТЗ): "подключать гитхаб"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s,k: has(s,k) -> exists assignment in s
// PURITY: CORE
// EFFECT: Effect<boolean, never, never>
// INVARIANT: ignores commented lines
// COMPLEXITY: O(n) where n = |lines|
export const hasEnvKey = (input: string, key: string): boolean => {
  const lines = splitLines(input)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const assignment = extractEnvAssignment(lines[i] ?? "")
    if (assignment && assignment.key === key) {
      return assignment.value.trim().length > 0
    }
  }
  return false
}

// CHANGE: resolve the latest value for an env key
// WHY: display current git identity in the UI
// QUOTE(ТЗ): "гит конфиг автоматически?"
// REF: user-request-2026-01-14
// SOURCE: n/a
// FORMAT THEOREM: forall s,k: value(s,k) = last_assignment(s,k) | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: ignores commented lines and empty assignments
// COMPLEXITY: O(n) where n = |lines|
export const findEnvValue = (input: string, key: string): string | null => {
  const lines = splitLines(input)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const assignment = extractEnvAssignment(lines[i] ?? "")
    if (assignment && assignment.key === key) {
      const value = stripQuotes(assignment.value).trim()
      return value.length > 0 ? value : null
    }
  }
  return null
}

// CHANGE: upsert or remove an env key in a text file
// WHY: persist integration credentials deterministically
// QUOTE(ТЗ): "подключать гитхаб"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s,k,v: upsert(s,k,v) contains k iff v != ""
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: output ends with newline
// COMPLEXITY: O(n) where n = |lines|
export const upsertEnvKey = (
  input: string,
  key: string,
  value: string
): string => {
  const sanitized = normalizeEnvText(input)
  const lines = splitLines(sanitized)
  const trimmedKey = key.trim()
  const cleaned = trimmedKey.length === 0 ? lines : lines.filter((line) => {
    const assignment = extractEnvAssignment(line)
    return assignment ? assignment.key !== trimmedKey : true
  })

  if (trimmedKey.length === 0 || value.trim().length === 0) {
    return normalizeEnvText(joinLines(cleaned))
  }

  return normalizeEnvText(joinLines([...cleaned, `${trimmedKey}=${value}`]))
}
