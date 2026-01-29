import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

type EnvEntry = {
  readonly key: string
  readonly value: string
}

const splitLines = (input: string): ReadonlyArray<string> =>
  input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")

const joinLines = (lines: ReadonlyArray<string>): string => lines.join("\n")

const normalizeEnvText = (input: string): string => {
  const normalized = joinLines(splitLines(input))
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`
}

const isAlpha = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

const isDigit = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return code >= 48 && code <= 57
}

const isValidFirstChar = (char: string): boolean => isAlpha(char) || char === "_"

const isValidEnvChar = (char: string): boolean => isAlpha(char) || isDigit(char) || char === "_"

const hasOnlyValidChars = (value: string): boolean => {
  for (const char of value) {
    if (!isValidEnvChar(char)) {
      return false
    }
  }
  return true
}

const isEnvKey = (value: string): boolean => {
  if (value.length === 0) {
    return false
  }
  const first = value[0] ?? ""
  if (!isValidFirstChar(first)) {
    return false
  }
  return hasOnlyValidChars(value.slice(1))
}

const parseEnvLine = (line: string): EnvEntry | null => {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return null
  }
  const raw = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed
  const eqIndex = raw.indexOf("=")
  if (eqIndex <= 0) {
    return null
  }
  const key = raw.slice(0, eqIndex).trim()
  if (!isEnvKey(key)) {
    return null
  }
  const value = raw.slice(eqIndex + 1).trim()
  return { key, value }
}

// CHANGE: parse env file contents into key/value entries
// WHY: allow updating shared auth env deterministically
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall t: parse(t) -> entries(t)
// PURITY: CORE
// INVARIANT: only valid KEY=VALUE lines are emitted
// COMPLEXITY: O(n) where n = |lines|
export const parseEnvEntries = (input: string): ReadonlyArray<EnvEntry> => {
  const entries: Array<EnvEntry> = []
  for (const line of splitLines(input)) {
    const parsed = parseEnvLine(line)
    if (parsed) {
      entries.push(parsed)
    }
  }
  return entries
}

// CHANGE: upsert a key in env contents
// WHY: update tokens without manual edits
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall k,v: upsert(k,v) -> env(k)=v
// PURITY: CORE
// INVARIANT: env ends with newline
// COMPLEXITY: O(n) where n = |lines|
export const upsertEnvKey = (input: string, key: string, value: string): string => {
  const sanitized = normalizeEnvText(input)
  const lines = splitLines(sanitized)
  const trimmedKey = key.trim()
  const cleaned = trimmedKey.length === 0 ? lines : lines.filter((line) => {
    const parsed = parseEnvLine(line)
    return parsed ? parsed.key !== trimmedKey : true
  })

  if (trimmedKey.length === 0 || value.trim().length === 0) {
    return normalizeEnvText(joinLines(cleaned))
  }

  return normalizeEnvText(joinLines([...cleaned, `${trimmedKey}=${value}`]))
}

// CHANGE: remove a key from env contents
// WHY: allow token revocation
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall k: remove(k) -> !env(k)
// PURITY: CORE
// INVARIANT: env ends with newline
// COMPLEXITY: O(n) where n = |lines|
export const removeEnvKey = (input: string, key: string): string => upsertEnvKey(input, key, "")

export const defaultEnvContents = "# docker-git env\n# KEY=value\n"

// CHANGE: ensure env file exists
// WHY: persist auth tokens in a stable file
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall p: ensure(p) -> exists(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: parent directories are created
// COMPLEXITY: O(1)
export const ensureEnvFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  envPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(envPath))
    if (exists) {
      return
    }
    yield* _(fs.makeDirectory(path.dirname(envPath), { recursive: true }))
    yield* _(fs.writeFileString(envPath, defaultEnvContents))
  })

// CHANGE: read env file contents
// WHY: list and update stored tokens
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall p: read(p) -> contents(p)
// PURITY: SHELL
// EFFECT: Effect<string, PlatformError, FileSystem>
// INVARIANT: returns default contents for missing/invalid file
// COMPLEXITY: O(n) where n = |file|
export const readEnvText = (
  fs: FileSystem.FileSystem,
  envPath: string
): Effect.Effect<string, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(envPath))
    if (!exists) {
      return defaultEnvContents
    }
    const info = yield* _(fs.stat(envPath))
    if (info.type !== "File") {
      return defaultEnvContents
    }
    return yield* _(fs.readFileString(envPath))
  })
