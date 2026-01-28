import { Effect } from "effect"
import * as Data from "effect/Data"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"

import { parseEnvEntries } from "./core/env.js"
import { resolveCodexAuthPath } from "./core/domain.js"

export interface CodexAuthStatus {
  readonly path: string
  readonly connected: boolean
  readonly entries: number
}

export interface CodexAccountEntry {
  readonly label: string
  readonly path: string
  readonly connected: boolean
  readonly entries: number
  readonly legacy: boolean
}

export class CodexAuthError extends Data.TaggedError("CodexAuthError")<{
  readonly message: string
}> {}

const normalizeInput = (input: string | undefined): string => input?.trim() ?? ""

const expandHome = (input: string, home: string | undefined): string => {
  if (input === "~") {
    return home ?? input
  }
  if (input.startsWith("~/")) {
    return home ? `${home}/${input.slice(2)}` : input
  }
  return input
}

const normalizeLabel = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ""
  }
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  return normalized.length > 0 ? normalized : ""
}

const normalizeCodexLabel = (value: string | undefined): string => {
  const normalized = normalizeLabel(value ?? "")
  return normalized.length === 0 ? "default" : normalized
}

const authMarker = "auth.json"
const codexConfigYamlName = "config.yml"
const authFiles: ReadonlyArray<string> = [
  "auth.json",
  "internal_storage.json",
  "version.json",
  codexConfigYamlName
]
const codexConfigKey = "cli_auth_credentials_store"
const codexConfigLine = `${codexConfigKey} = "file"`
const codexApprovalPolicyKey = "approval_policy"
const codexApprovalPolicyLine = `${codexApprovalPolicyKey} = "never"`
const codexSandboxModeKey = "sandbox_mode"
const codexSandboxModeLine = `${codexSandboxModeKey} = "danger-full-access"`
const codexConfigTomlContents = `model = "gpt-5.2-codex"
model_reasoning_effort = "xhigh"
${codexApprovalPolicyLine}
${codexSandboxModeLine}
${codexConfigLine}

[features]
web_search_request = true

[projects."/home/dev"]
trust_level = "trusted"

[projects."/home/dev/app"]
trust_level = "trusted"

[projects."/home/dev/.codex"]
trust_level = "trusted"
`
const codexConfigYamlContents = `model = "gpt-5.2-codex"
model_reasoning_effort = "xhigh"
approval_policy = "never"
sandbox_mode = "danger-full-access"

[features]
web_search_request = true
`

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "")

// CHANGE: derive per-project Codex auth path under a root
// WHY: avoid shared root collisions between multiple projects
// QUOTE(ТЗ): "Почему он не видит авторизацию тогда?"
// REF: user-request-2026-01-14
// SOURCE: n/a
// FORMAT THEOREM: forall r,p: path(r,p) = r + "/" + p
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: no trailing slash in root
// COMPLEXITY: O(1)
export const resolveProjectCodexAuthPath = (root: string, projectId: string): string =>
  `${trimTrailingSlash(root)}/${projectId}`

const hasAuthMarker = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dirPath: string
): Effect.Effect<boolean, PlatformError> =>
  fs.exists(path.join(dirPath, authMarker))

// CHANGE: resolve Codex auth source path from input and environment
// WHY: provide a deterministic import path for Codex credentials
// QUOTE(ТЗ): "Добавь подключение Codex в интеграции"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s: resolve(s) -> path | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: empty input falls back to CODEX_HOME or HOME/.codex
// COMPLEXITY: O(1)
export const resolveCodexSourcePath = (
  input: string | undefined,
  home: string | undefined,
  codexHome: string | undefined
): string | null => {
  const trimmed = normalizeInput(input)
  if (trimmed.length > 0) {
    return expandHome(trimmed, home)
  }

  const fallback = normalizeInput(codexHome)
  if (fallback.length > 0) {
    return expandHome(fallback, home)
  }

  return home && home.length > 0 ? `${home}/.codex` : null
}

// CHANGE: read Codex auth status from a directory
// WHY: show whether Codex credentials are available in integrations
// QUOTE(ТЗ): "Добавь подключение Codex в интеграции"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall p: status(p) -> connected(p)
// PURITY: SHELL
// EFFECT: Effect<CodexAuthStatus, PlatformError, FileSystem | Path>
// INVARIANT: connected iff directory exists and has entries
// COMPLEXITY: O(n) where n = |entries|
export const readCodexAuthStatus = (
  authPath: string
): Effect.Effect<CodexAuthStatus, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const exists = yield* _(fs.exists(authPath))
    if (!exists) {
      return { path: authPath, connected: false, entries: 0 }
    }

    const info = yield* _(fs.stat(authPath))
    if (info.type !== "Directory") {
      return { path: authPath, connected: false, entries: 0 }
    }

    const entries = yield* _(fs.readDirectory(authPath))
    return {
      path: authPath,
      connected: entries.length > 0,
      entries: entries.length
    }
  })

// CHANGE: list Codex auth accounts in the shared secrets root
// WHY: allow multiple Codex integrations to coexist
// QUOTE(ТЗ): "Добавь подключение Codex в интеграции"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall r: list(r) = accounts(r)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<CodexAccountEntry>, PlatformError, FileSystem | Path>
// INVARIANT: legacy root files map to label "default"
// COMPLEXITY: O(n) where n = |entries|
export const listCodexAccounts = (
  rootPath: string
): Effect.Effect<ReadonlyArray<CodexAccountEntry>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const exists = yield* _(fs.exists(rootPath))
    if (!exists) {
      return []
    }

    const info = yield* _(fs.stat(rootPath))
    if (info.type !== "Directory") {
      return []
    }

    const entries = yield* _(fs.readDirectory(rootPath))
    let hasDefaultDir = false
    const legacyAuth = yield* _(hasAuthMarker(fs, path, rootPath))
    const accounts: Array<CodexAccountEntry> = []

    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry)
      const entryInfo = yield* _(fs.stat(entryPath))
      if (entryInfo.type === "Directory") {
        if (entry === "default") {
          hasDefaultDir = true
        }
        const isAccount = yield* _(hasAuthMarker(fs, path, entryPath))
        if (isAccount) {
          const status = yield* _(readCodexAuthStatus(entryPath))
          accounts.push({
            label: entry,
            path: entryPath,
            connected: status.connected,
            entries: status.entries,
            legacy: false
          })
        }
      }
    }

    if (legacyAuth && !hasDefaultDir) {
      const status = yield* _(readCodexAuthStatus(rootPath))
      accounts.unshift({
        label: "default",
        path: rootPath,
        connected: status.connected,
        entries: status.entries,
        legacy: true
      })
    }

    return accounts
  })

const resolveAccountPath = (rootPath: string, label: string): string => {
  const normalized = normalizeCodexLabel(label)
  return `${rootPath}/${normalized}`
}

const ensureCodexConfig = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  accountPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function* (_) {
    const configPath = path.join(accountPath, "config.toml")
    // Always overwrite to avoid copying host project trust entries.
    yield* _(fs.writeFileString(configPath, codexConfigTomlContents))
  })

// CHANGE: ensure Codex config.yml exists with required settings
// WHY: propagate model settings into the mounted Codex auth directory
// QUOTE(ТЗ): "Добавь конфиг config.yml"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall p: ensure(p) -> exists(config.yml, p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: file is overwritten with requested contents
// COMPLEXITY: O(1)
const ensureCodexConfigYaml = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  accountPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function* (_) {
    const configPath = path.join(accountPath, codexConfigYamlName)
    yield* _(fs.writeFileString(configPath, codexConfigYamlContents))
  })

const ensureWritableDirectory = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dirPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function* (_) {
    const ensureDir = yield* _(Effect.either(fs.makeDirectory(dirPath, { recursive: true })))
    if (ensureDir._tag === "Left") {
      return false
    }
    const probePath = path.join(dirPath, ".dg-write-test")
    const writeResult = yield* _(Effect.either(fs.writeFileString(probePath, "ok")))
    if (writeResult._tag === "Left") {
      return false
    }
    yield* _(fs.remove(probePath, { force: true }))
    return true
  })

// CHANGE: resolve a writable Codex auth root directory
// WHY: allow Codex auth to be persisted by the host orchestrator
// QUOTE(ТЗ): "Я не могу нормально пока прокинуть авторизацию Codex"
// REF: user-request-2026-01-14
// SOURCE: n/a
// FORMAT THEOREM: forall root: writable(root) -> select(root)
// PURITY: SHELL
// EFFECT: Effect<string, CodexAuthError | PlatformError, FileSystem | Path>
// INVARIANT: returns a directory writable by the orchestrator
// COMPLEXITY: O(1)
export const resolveWritableCodexRoot = (
  projectsRoot: string
): Effect.Effect<string, CodexAuthError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const baseRoot = path.resolve(resolveCodexAuthPath(projectsRoot))
    const baseWritable = yield* _(ensureWritableDirectory(fs, path, baseRoot))
    if (baseWritable) {
      return baseRoot
    }

    const fallbackRoot = `${baseRoot}-host`
    const fallbackWritable = yield* _(ensureWritableDirectory(fs, path, fallbackRoot))
    if (fallbackWritable) {
      return fallbackRoot
    }

    const envRoot = resolveCodexSourcePath(
      undefined,
      process.env["HOME"],
      process.env["CODEX_HOME"]
    )
    if (envRoot) {
      const resolvedEnvRoot = path.resolve(envRoot)
      const envWritable = yield* _(ensureWritableDirectory(fs, path, resolvedEnvRoot))
      if (envWritable) {
        return resolvedEnvRoot
      }
    }

    return yield* _(
      Effect.fail(
        new CodexAuthError({
          message: `Codex auth root is not writable: ${baseRoot}`
        })
      )
    )
  })

// CHANGE: prepare a Codex CLI auth directory for a labeled account
// WHY: ensure device auth writes credentials into a dedicated CODEX_HOME
// QUOTE(ТЗ): "Мне нужна прямо нативная интеграция с Codex"
// REF: user-request-2026-01-10
// SOURCE: n/a
// FORMAT THEOREM: forall r,l: prepare(r,l) -> exists(dir(r,l))
// PURITY: SHELL
// EFFECT: Effect<string, PlatformError, FileSystem | Path>
// INVARIANT: config.toml contains cli_auth_credentials_store = "file"
// COMPLEXITY: O(n) where n = |config|
export const prepareCodexAccountDir = (
  rootPath: string,
  label: string
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const accountPath = resolveAccountPath(rootPath, label)
    yield* _(fs.makeDirectory(accountPath, { recursive: true }))
    yield* _(ensureCodexConfig(fs, path, accountPath))
    yield* _(ensureCodexConfigYaml(fs, path, accountPath))
    return accountPath
  })

// CHANGE: import Codex auth cache into a labeled integration directory
// WHY: allow multiple Codex integrations in the orchestrator
// QUOTE(ТЗ): "Добавь подключение Codex в интеграции"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s,l: import(s,l) -> exists(account(l))
// PURITY: SHELL
// EFFECT: Effect<void, CodexAuthError | PlatformError, FileSystem | Path>
// INVARIANT: target directory is replaced
// COMPLEXITY: O(n) where n = |files|
export const importCodexAuthDir = (
  sourcePath: string,
  rootPath: string,
  label: string
): Effect.Effect<void, CodexAuthError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const exists = yield* _(fs.exists(sourcePath))
    if (!exists) {
      yield* _(
        Effect.fail(
          new CodexAuthError({ message: `Source not found: ${sourcePath}` })
        )
      )
      return
    }

    const info = yield* _(fs.stat(sourcePath))
    if (info.type !== "Directory") {
      yield* _(
        Effect.fail(
          new CodexAuthError({ message: `Source is not a directory: ${sourcePath}` })
        )
      )
      return
    }

    const target = resolveAccountPath(rootPath, label)
    yield* _(fs.makeDirectory(path.dirname(target), { recursive: true }))
    yield* _(fs.remove(target, { recursive: true, force: true }))
    yield* _(fs.makeDirectory(target, { recursive: true }))
    for (const file of authFiles) {
      const src = path.join(sourcePath, file)
      const dst = path.join(target, file)
      const exists = yield* _(fs.exists(src))
      if (exists) {
        yield* _(fs.copyFile(src, dst))
      }
    }
    yield* _(ensureCodexConfig(fs, path, target))
    yield* _(ensureCodexConfigYaml(fs, path, target))
  })

// CHANGE: copy Codex auth cache to a destination directory
// WHY: attach a selected Codex integration to a project
// QUOTE(ТЗ): "хочу подключить 10 Codex интеграций"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s,d: copy(s,d) -> exists(d)
// PURITY: SHELL
// EFFECT: Effect<void, CodexAuthError | PlatformError, FileSystem | Path>
// INVARIANT: destination directory is replaced
// COMPLEXITY: O(n) where n = |files|
export const copyCodexAuthDir = (
  sourcePath: string,
  destPath: string
): Effect.Effect<void, CodexAuthError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const exists = yield* _(fs.exists(sourcePath))
    if (!exists) {
      yield* _(
        Effect.fail(
          new CodexAuthError({ message: `Source not found: ${sourcePath}` })
        )
      )
      return
    }

    const info = yield* _(fs.stat(sourcePath))
    if (info.type !== "Directory") {
      yield* _(
        Effect.fail(
          new CodexAuthError({ message: `Source is not a directory: ${sourcePath}` })
        )
      )
      return
    }

    yield* _(fs.remove(destPath, { recursive: true, force: true }))
    yield* _(fs.makeDirectory(path.dirname(destPath), { recursive: true }))
    yield* _(fs.makeDirectory(destPath, { recursive: true }))
    for (const file of authFiles) {
      const src = path.join(sourcePath, file)
      const dst = path.join(destPath, file)
      const exists = yield* _(fs.exists(src))
      if (exists) {
        yield* _(fs.copyFile(src, dst))
      }
    }
    yield* _(ensureCodexConfig(fs, path, destPath))
    yield* _(ensureCodexConfigYaml(fs, path, destPath))
  })

// CHANGE: remove a Codex integration by label
// WHY: allow deleting an individual Codex account
// QUOTE(ТЗ): "хочу подключить 10 Codex интеграций"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall r,l: remove(r,l) -> not exists(account(l))
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: only the labeled account is removed
// COMPLEXITY: O(n) where n = |entries|
export const removeCodexAccount = (
  rootPath: string,
  label: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const normalized = normalizeCodexLabel(label)
    const target = resolveAccountPath(rootPath, normalized)
    const targetExists = yield* _(fs.exists(target))
    if (targetExists) {
      yield* _(fs.remove(target, { recursive: true, force: true }))
      return
    }

    if (normalized !== "default") {
      return
    }

    const rootExists = yield* _(fs.exists(rootPath))
    if (!rootExists) {
      return
    }

    const rootInfo = yield* _(fs.stat(rootPath))
    if (rootInfo.type !== "Directory") {
      return
    }

    const hasLegacy = yield* _(hasAuthMarker(fs, path, rootPath))
    if (!hasLegacy) {
      return
    }

    const entries = yield* _(fs.readDirectory(rootPath))
    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry)
      const entryInfo = yield* _(fs.stat(entryPath))
      if (entryInfo.type === "Directory") {
        const isAccount = yield* _(hasAuthMarker(fs, path, entryPath))
        if (!isAccount) {
          yield* _(fs.remove(entryPath, { recursive: true, force: true }))
        }
      } else {
        yield* _(fs.remove(entryPath, { recursive: true, force: true }))
      }
    }
  })

// CHANGE: clear Codex auth cache for a path
// WHY: allow disconnecting Codex from a project
// QUOTE(ТЗ): "хочу подключить 10 Codex интеграций"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall p: clear(p) -> empty(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: directory exists after clear
// COMPLEXITY: O(n) where n = |files|
export const clearCodexAuthDir = (
  destPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    yield* _(fs.remove(destPath, { recursive: true, force: true }))
    yield* _(fs.makeDirectory(destPath, { recursive: true }))
  })

// CHANGE: locate a Codex integration path by label
// WHY: map project selection to a concrete auth directory
// QUOTE(ТЗ): "хочу подключить 10 Codex интеграций"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall r,l: find(r,l) -> path | null
// PURITY: SHELL
// EFFECT: Effect<string | null, PlatformError, FileSystem | Path>
// INVARIANT: legacy default is resolved to root when present
// COMPLEXITY: O(n) where n = |entries|
export const findCodexAccountPath = (
  rootPath: string,
  label: string
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const normalized = normalizeCodexLabel(label)
    const target = resolveAccountPath(rootPath, normalized)
    const targetExists = yield* _(fs.exists(target))
    if (targetExists) {
      const isAccount = yield* _(hasAuthMarker(fs, path, target))
      return isAccount ? target : null
    }

    if (normalized !== "default") {
      return null
    }

    const rootExists = yield* _(fs.exists(rootPath))
    if (!rootExists) {
      return null
    }

    const info = yield* _(fs.stat(rootPath))
    if (info.type !== "Directory") {
      return null
    }

    const legacy = yield* _(hasAuthMarker(fs, path, rootPath))
    return legacy ? rootPath : null
  })

// CHANGE: resolve Codex label stored in a project env file
// WHY: show which Codex account is active for a project
// QUOTE(ТЗ): "хочу подключить 10 Codex интеграций"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall env: label(env) -> string | null
// PURITY: CORE
// EFFECT: Effect<string | null, never, never>
// INVARIANT: empty values map to null
// COMPLEXITY: O(n) where n = |lines|
export const resolveProjectCodexLabel = (envText: string): string | null => {
  const entry = parseEnvEntries(envText).find((item) => item.key === "CODEX_AUTH_LABEL")
  if (!entry) {
    return null
  }
  const trimmed = entry.value.trim()
  return trimmed.length > 0 ? trimmed : null
}
