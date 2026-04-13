import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { asObject, asString, type JsonValue } from "./api-json.js"
import { defaultTemplateConfig } from "./frontend-lib/core/domain.js"
import type { CreateCommand } from "./frontend-lib/core/domain.js"
import {
  findAuthorizedKeysSource,
  findExistingPath,
  findSshPrivateKey,
  resolvePathFromCwd
} from "./frontend-lib/usecases/path-helpers.js"

type ClientPathContext = {
  readonly cwd: string
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
}

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

const normalizeAuthorizedKeysContents = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : `${trimmed}\n`
}

const readClientPathContext = (): Effect.Effect<ClientPathContext, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    return {
      cwd: process.cwd(),
      fs,
      path
    }
  })

const resolveManagedAuthorizedKeysContents = () =>
  Effect.gen(function*(_) {
    const context = yield* _(readClientPathContext())
    const sshPrivateKey = yield* _(findSshPrivateKey(context.fs, context.path, context.cwd))
    const matchingPublicKey = sshPrivateKey === null
      ? null
      : yield* _(findExistingPath(context.fs, `${sshPrivateKey}.pub`))
    const source = matchingPublicKey === null
      ? yield* _(findAuthorizedKeysSource(context.fs, context.path, context.cwd))
      : matchingPublicKey

    if (source === null) {
      return missingAuthorizedKeysContents()
    }

    const contents = yield* _(context.fs.readFileString(source))
    return normalizeAuthorizedKeysContents(contents)
  })

export const resolveCreateRequestPaths = (command: CreateCommand) =>
  Effect.gen(function*(_) {
    const context = yield* _(readClientPathContext())
    const authorizedKeysPath = command.config.authorizedKeysPath === defaultTemplateConfig.authorizedKeysPath
      ? command.config.authorizedKeysPath
      : resolveClientCreatePath(context.path, context.cwd, command.config.authorizedKeysPath)
    const authorizedKeysContents = authorizedKeysPath === defaultTemplateConfig.authorizedKeysPath
      ? yield* _(resolveManagedAuthorizedKeysContents())
      : yield* _(
        context.fs.exists(authorizedKeysPath).pipe(
          Effect.flatMap((exists) =>
            exists
              ? context.fs.readFileString(authorizedKeysPath).pipe(
                Effect.map((contents) => normalizeAuthorizedKeysContents(contents))
              )
              : Effect.sync(missingAuthorizedKeysContents)
          )
        )
      )

    return {
      authorizedKeysPath,
      authorizedKeysContents
    }
  })
