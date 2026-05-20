import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { hasNonEmptyFile } from "./menu-auth-file-helpers.js"

type HasCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
) => Effect.Effect<boolean, PlatformError>

type CredentialDirectoryCounterInput = {
  readonly fs: FileSystem.FileSystem
  readonly hasCredentials: HasCredentials
  readonly path: Path.Path
  readonly root: string
}

const ignoredAuthAccountEntries: ReadonlySet<string> = new Set([".image"])

export const hasCodexAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> => hasNonEmptyFile(fs, `${accountPath}/auth.json`)

const countCredentialDirectories = ({
  fs,
  hasCredentials,
  path,
  root
}: CredentialDirectoryCounterInput): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
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

const countExistingCredentialDirectories = (
  input: CredentialDirectoryCounterInput
): Effect.Effect<number, PlatformError> =>
  input.fs.exists(input.root).pipe(
    Effect.flatMap((exists) =>
      exists
        ? countCredentialDirectories(input)
        : Effect.succeed(0)
    )
  )

export const countAuthCredentialAccounts = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  hasCredentials: HasCredentials
): Effect.Effect<number, PlatformError> => countExistingCredentialDirectories({ fs, hasCredentials, path, root })

export const countCodexCredentialAccounts = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<number, PlatformError> =>
  fs.exists(root).pipe(
    Effect.flatMap((exists) => {
      if (!exists) {
        return Effect.succeed(0)
      }
      return Effect.all({
        directoryCount: countCredentialDirectories({
          fs,
          hasCredentials: hasCodexAccountCredentials,
          path,
          root
        }),
        rootConnected: hasCodexAccountCredentials(fs, root).pipe(Effect.orElseSucceed(() => false))
      }).pipe(
        Effect.map(({ directoryCount, rootConnected }) => directoryCount + (rootConnected ? 1 : 0))
      )
    })
  )
