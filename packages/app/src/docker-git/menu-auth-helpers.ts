import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

type HasCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
) => Effect.Effect<boolean, PlatformError>

const ignoredAuthAccountEntries: ReadonlySet<string> = new Set([".image"])

const hasFileAtPath = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return false
    }
    const info = yield* _(fs.stat(filePath))
    return info.type === "File"
  })

const hasNonEmptyFile = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, filePath))
    if (!hasFile) {
      return false
    }
    const content = yield* _(fs.readFileString(filePath), Effect.orElseSucceed(() => ""))
    return content.trim().length > 0
  })

export const countAuthCredentialAccounts = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  hasCredentials: HasCredentials
): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(root))
    if (!exists) {
      return 0
    }
    const entries = yield* _(fs.readDirectory(root))
    let count = 0
    for (const entry of entries) {
      if (ignoredAuthAccountEntries.has(entry)) {
        continue
      }
      const accountPath = path.join(root, entry)
      const info = yield* _(fs.stat(accountPath))
      if (info.type !== "Directory") {
        continue
      }
      const connected = yield* _(hasCredentials(fs, accountPath), Effect.orElseSucceed(() => false))
      if (connected) {
        count += 1
      }
    }
    return count
  })

export const hasCodexAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasNonEmptyFile(fs, `${accountPath}/auth.json`)

export const countCodexCredentialAccounts = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(root))
    if (!exists) {
      return 0
    }

    let count = yield* _(hasCodexAccountCredentials(fs, root), Effect.map((connected) => connected ? 1 : 0))
    const entries = yield* _(fs.readDirectory(root))
    for (const entry of entries) {
      if (ignoredAuthAccountEntries.has(entry)) {
        continue
      }
      const accountPath = path.join(root, entry)
      const info = yield* _(fs.stat(accountPath))
      if (info.type !== "Directory") {
        continue
      }
      const connected = yield* _(hasCodexAccountCredentials(fs, accountPath), Effect.orElseSucceed(() => false))
      if (connected) {
        count += 1
      }
    }
    return count
  })
