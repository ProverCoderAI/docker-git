import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

type EnvEntry = {
  readonly key: string
  readonly value: string
}

export type InvalidComposeEnvLine = {
  readonly lineNumber: number
  readonly content: string
}

export type ComposeEnvInspection = {
  readonly sanitized: string
  readonly invalidLines: ReadonlyArray<InvalidComposeEnvLine>
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

const inspectComposeEnvLine = (line: string): string | null => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return ""
  }
  if (trimmed.startsWith("#")) {
    return trimmed
  }

  const parsed = parseEnvLine(line)
  return parsed ? `${parsed.key}=${parsed.value}` : null
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

// CHANGE: resolve the latest value for an env key
// WHY: support label-based lookups without allocating full entry lists
// QUOTE(ТЗ): "токенов может быть милион ... без хардкода"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall s,k: value(s,k) = last_assignment(s,k) | null
// PURITY: CORE
// INVARIANT: ignores commented/invalid lines and empty assignments
// COMPLEXITY: O(n) where n = |lines|
export const findEnvValue = (input: string, key: string): string | null => {
  const trimmedKey = key.trim()
  if (trimmedKey.length === 0) {
    return null
  }
  const lines = splitLines(input)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseEnvLine(lines[i] ?? "")
    if (parsed && parsed.key === trimmedKey) {
      const value = parsed.value.trim()
      return value.length > 0 ? value : null
    }
  }
  return null
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

// CHANGE: inspect compose env text and canonicalize supported assignments
// WHY: docker compose env_file rejects merge markers and shell-only syntax
// QUOTE(ТЗ): n/a
// REF: user-request-2026-02-26-invalid-project-env
// SOURCE: n/a
// FORMAT THEOREM: ∀l ∈ lines(input): valid_env(l) ∨ comment(l) ∨ empty(l) → l ∈ sanitized(input)
// PURITY: CORE
// INVARIANT: invalid non-comment lines are removed and reported with 1-based line numbers
// COMPLEXITY: O(n) where n = |lines|
export const inspectComposeEnvText = (input: string): ComposeEnvInspection => {
  const sanitizedLines: Array<string> = []
  const invalidLines: Array<InvalidComposeEnvLine> = []
  const lines = splitLines(input)

  for (const [index, line] of lines.entries()) {
    const sanitizedLine = inspectComposeEnvLine(line)

    if (sanitizedLine === null) {
      invalidLines.push({
        lineNumber: index + 1,
        content: line
      })
      continue
    }

    sanitizedLines.push(sanitizedLine)
  }

  return {
    sanitized: normalizeEnvText(joinLines(sanitizedLines)),
    invalidLines
  }
}

// CHANGE: sanitize compose env file contents in place
// WHY: make docker compose env_file inputs deterministic and parseable
// QUOTE(ТЗ): n/a
// REF: user-request-2026-02-26-invalid-project-env
// SOURCE: n/a
// FORMAT THEOREM: ∀p: exists_file(p) → compose_safe(read(p)) after sanitize(p)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<InvalidComposeEnvLine>, PlatformError, FileSystem>
// INVARIANT: missing or non-file paths are ignored
// COMPLEXITY: O(n) where n = |file|
export const sanitizeComposeEnvFile = (
  fs: FileSystem.FileSystem,
  envPath: string
): Effect.Effect<ReadonlyArray<InvalidComposeEnvLine>, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(envPath))
    if (!exists) {
      return []
    }

    const info = yield* _(fs.stat(envPath))
    if (info.type !== "File") {
      return []
    }

    const current = yield* _(fs.readFileString(envPath))
    const inspected = inspectComposeEnvText(current)
    if (inspected.sanitized !== normalizeEnvText(current)) {
      yield* _(fs.writeFileString(envPath, inspected.sanitized))
    }
    return inspected.invalidLines
  })

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
