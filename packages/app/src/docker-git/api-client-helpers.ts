import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { asObject, asString, type JsonValue } from "./api-json.js"
import { defaultTemplateConfig } from "./frontend-lib/core/domain.js"
import type { CreateCommand } from "./frontend-lib/core/domain.js"
import { resolvePathFromCwd } from "./frontend-lib/usecases/path-helpers.js"

export const readProjectOutput = (payload: JsonValue): string => {
  const object = asObject(payload)
  return asString(object?.["output"]) ?? ""
}

const normalizeRelativePath = (value: string): string =>
  value
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .trim()

const isManagedCreatePath = (value: string): boolean => {
  const normalized = normalizeRelativePath(value)
  return normalized === ".docker-git" ||
    normalized === ".orch" ||
    normalized.startsWith(".docker-git/") ||
    normalized.startsWith(".orch/")
}

const resolveClientCreatePath = (
  path: Path.Path,
  cwd: string,
  targetPath: string
): string =>
  path.isAbsolute(targetPath) || isManagedCreatePath(targetPath)
    ? targetPath
    : resolvePathFromCwd(path, cwd, targetPath)

const missingAuthorizedKeysContents = (): string | undefined => undefined

export const resolveCreateRequestPaths = (command: CreateCommand) =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const cwd = process.cwd()
    const authorizedKeysPath = command.config.authorizedKeysPath === defaultTemplateConfig.authorizedKeysPath
      ? command.config.authorizedKeysPath
      : resolveClientCreatePath(path, cwd, command.config.authorizedKeysPath)
    const authorizedKeysContents = authorizedKeysPath === defaultTemplateConfig.authorizedKeysPath
      ? undefined
      : yield* _(
        fs.exists(authorizedKeysPath).pipe(
          Effect.flatMap((exists) =>
            exists ? fs.readFileString(authorizedKeysPath) : Effect.sync(missingAuthorizedKeysContents)
          )
        )
      )

    return {
      authorizedKeysPath,
      authorizedKeysContents
    }
  })
