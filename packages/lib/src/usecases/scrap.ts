import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"
import { Effect, Either } from "effect"

import type { ScrapExportCommand, ScrapImportCommand } from "../core/domain.js"
import { runCommandWithExitCodes } from "../shell/command-runner.js"
import { readProjectConfig } from "../shell/config.js"
import { ensureDockerDaemonAccess } from "../shell/docker.js"
import type { CommandFailedError, ConfigDecodeError, ConfigNotFoundError, DockerAccessError } from "../shell/errors.js"
import {
  CommandFailedError as CommandFailedErrorClass,
  ScrapArchiveNotFoundError,
  ScrapTargetDirUnsupportedError,
  ScrapWipeRefusedError
} from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"
import { resolvePathFromCwd } from "./path-helpers.js"

export type ScrapError =
  | ScrapArchiveNotFoundError
  | ScrapTargetDirUnsupportedError
  | ScrapWipeRefusedError
  | ConfigNotFoundError
  | ConfigDecodeError
  | DockerAccessError
  | CommandFailedError
  | PlatformError

type ScrapRequirements = Fs | PathService | CommandExecutor.CommandExecutor

const dockerOk = [0]
const scrapImage = "alpine:3.20"

type ScrapTemplate = {
  readonly sshUser: string
  readonly targetDir: string
  readonly volumeName: string
}

type ScrapImportContext = {
  readonly fs: Fs
  readonly path: PathService
  readonly resolved: string
  readonly template: ScrapTemplate
  readonly relative: string
  readonly archiveAbs: string
  readonly archiveDir: string
  readonly archiveName: string
  readonly workspacePath: string
}

const normalizeContainerPath = (value: string): string => value.replaceAll("\\", "/").trim()

const trimTrailingPosixSlashes = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") {
    end -= 1
  }
  return value.slice(0, end)
}

const hasParentTraversalSegment = (value: string): boolean => value.split("/").includes("..")

// CHANGE: derive a /home/<sshUser>-relative workspace path from the configured targetDir
// WHY: docker-git workspaces live inside the named home volume mounted at /home/<sshUser>
// QUOTE(ТЗ): "мог копировать скрап (кеш) от докер контейнеров"
// REF: issue-27
// SOURCE: n/a
// FORMAT THEOREM: ∀u,d: underHome(d,u) → relative(d,u) ∈ Path* ∧ ¬contains("..")
// PURITY: CORE
// EFFECT: Effect<string, ScrapTargetDirUnsupportedError, never>
// INVARIANT: left result iff targetDir is not within /home/<sshUser> or contains parent traversal
// COMPLEXITY: O(|targetDir|)
export const deriveScrapWorkspaceRelativePath = (
  sshUser: string,
  targetDir: string
): Either.Either<string, ScrapTargetDirUnsupportedError> => {
  const normalizedTarget = trimTrailingPosixSlashes(normalizeContainerPath(targetDir))
  const homeDir = `/home/${sshUser}`
  const normalizedHome = trimTrailingPosixSlashes(homeDir)

  if (hasParentTraversalSegment(normalizedTarget)) {
    return Either.left(
      new ScrapTargetDirUnsupportedError({
        sshUser,
        targetDir,
        reason: "targetDir must not contain '..' path segments"
      })
    )
  }

  if (normalizedTarget === normalizedHome) {
    return Either.right("")
  }

  const prefix = `${normalizedHome}/`
  if (!normalizedTarget.startsWith(prefix)) {
    return Either.left(
      new ScrapTargetDirUnsupportedError({
        sshUser,
        targetDir,
        reason: `targetDir must be under ${normalizedHome}`
      })
    )
  }

  const rawRelative = normalizedTarget.slice(prefix.length)
  const relative = rawRelative
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/")

  if (relative.length === 0) {
    return Either.right("")
  }

  if (hasParentTraversalSegment(relative)) {
    return Either.left(
      new ScrapTargetDirUnsupportedError({
        sshUser,
        targetDir,
        reason: "targetDir must not contain '..' path segments"
      })
    )
  }

  return Either.right(relative)
}

const toEffect = <A, E>(either: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.match(either, {
    onLeft: (error) => Effect.fail(error),
    onRight: (value) => Effect.succeed(value)
  })

const workspacePathFromRelative = (relative: string): string =>
  relative.length === 0 ? "/volume" : `/volume/${relative}`

const runDockerScrap = (
  cwd: string,
  label: string,
  args: ReadonlyArray<string>
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    { cwd, command: "docker", args: ["run", "--rm", ...args] },
    dockerOk,
    (exitCode) => new CommandFailedErrorClass({ command: `docker run (${label})`, exitCode })
  )

// CHANGE: export workspace scrap (cache) from the docker home volume to a host archive
// WHY: allow reusing installed dependencies and workspace state across machines
// QUOTE(ТЗ): "мог копировать скрап (кеш) от докер контейнеров"
// REF: issue-27
// SOURCE: n/a
// FORMAT THEOREM: export(p) → exists(archive(p))
// PURITY: SHELL
// EFFECT: Effect<void, ScrapError, FileSystem | Path | CommandExecutor>
// INVARIANT: archive path is resolved from the project directory when relative
// COMPLEXITY: O(command + archive_size)
export const exportScrap = (
  command: ScrapExportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    yield* _(ensureDockerDaemonAccess(process.cwd()))

    const { fs, path, resolved } = yield* _(resolveBaseDir(command.projectDir))
    const config = yield* _(readProjectConfig(resolved))
    const template = config.template

    const relative = yield* _(toEffect(deriveScrapWorkspaceRelativePath(template.sshUser, template.targetDir)))
    const archiveAbs = resolvePathFromCwd(path, resolved, command.archivePath)
    const archiveDir = path.dirname(archiveAbs)
    const archiveName = path.basename(archiveAbs)
    const workspacePath = relative.length === 0 ? "/volume" : `/volume/${relative}`

    yield* _(fs.makeDirectory(archiveDir, { recursive: true }))

    yield* _(Effect.log(`Project: ${resolved}`))
    yield* _(Effect.log(`Volume: ${template.volumeName}`))
    yield* _(Effect.log(`Workspace: ${template.targetDir}`))
    yield* _(Effect.log(`Archive: ${archiveAbs}`))
    yield* _(Effect.log("Exporting scrap archive..."))

    const script = [
      "set -e",
      `SRC="${workspacePath}"`,
      `OUT="/out/${archiveName}"`,
      "if [ ! -d \"$SRC\" ]; then echo \"Workspace dir not found: $SRC\" >&2; exit 2; fi",
      "tar czf \"$OUT\" -C \"$SRC\" ."
    ].join("; ")

    yield* _(
      runDockerScrap(resolved, "scrap export", [
        "--user",
        "1000:1000",
        "-v",
        `${template.volumeName}:/volume:ro`,
        "-v",
        `${archiveDir}:/out`,
        scrapImage,
        "sh",
        "-lc",
        script
      ])
    )

    yield* _(Effect.log("Scrap export complete."))
  }).pipe(Effect.asVoid)

const ensureArchiveExists = (
  fs: Fs,
  path: PathService,
  projectDir: string,
  archivePath: string
): Effect.Effect<string, ScrapArchiveNotFoundError | PlatformError> =>
  Effect.gen(function*(_) {
    const archiveAbs = resolvePathFromCwd(path, projectDir, archivePath)
    const exists = yield* _(fs.exists(archiveAbs))
    if (!exists) {
      return yield* _(Effect.fail(new ScrapArchiveNotFoundError({ path: archiveAbs })))
    }

    const stat = yield* _(fs.stat(archiveAbs))
    if (stat.type !== "File") {
      return yield* _(Effect.fail(new ScrapArchiveNotFoundError({ path: archiveAbs })))
    }

    return archiveAbs
  })

const ensureSafeScrapImportWipe = (
  wipe: boolean,
  template: ScrapTemplate,
  relative: string
): Effect.Effect<void, ScrapWipeRefusedError> =>
  wipe && relative.length === 0
    ? Effect.fail(
      new ScrapWipeRefusedError({
        sshUser: template.sshUser,
        targetDir: template.targetDir,
        reason: `wipe would target /home/${template.sshUser}`
      })
    )
    : Effect.void

const logScrapImportPlan = (
  resolved: string,
  template: ScrapTemplate,
  archiveAbs: string,
  wipe: boolean
): Effect.Effect<void> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Project: ${resolved}`))
    yield* _(Effect.log(`Volume: ${template.volumeName}`))
    yield* _(Effect.log(`Workspace: ${template.targetDir}`))
    yield* _(Effect.log(`Archive: ${archiveAbs}`))
    yield* _(Effect.log(`Wipe: ${wipe ? "yes" : "no"}`))
    yield* _(Effect.log("Importing scrap archive..."))
  }).pipe(Effect.asVoid)

const buildScrapImportScript = (
  archiveName: string,
  workspacePath: string,
  wipe: boolean
): string => {
  const wipeLine = wipe ? "rm -rf \"$DST\"" : ":"
  return [
    "set -e",
    `ARCHIVE="/in/${archiveName}"`,
    `DST="${workspacePath}"`,
    "if [ ! -f \"$ARCHIVE\" ]; then echo \"Archive not found: $ARCHIVE\" >&2; exit 2; fi",
    wipeLine,
    "mkdir -p \"$DST\"",
    "tar xzf \"$ARCHIVE\" -C \"$DST\""
  ].join("; ")
}

const loadScrapImportContext = (
  command: ScrapImportCommand
): Effect.Effect<
  ScrapImportContext,
  ScrapArchiveNotFoundError | ScrapTargetDirUnsupportedError | ConfigNotFoundError | ConfigDecodeError | PlatformError,
  Fs | PathService
> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(command.projectDir))
    const config = yield* _(readProjectConfig(resolved))
    const template: ScrapTemplate = {
      sshUser: config.template.sshUser,
      targetDir: config.template.targetDir,
      volumeName: config.template.volumeName
    }

    const relative = yield* _(toEffect(deriveScrapWorkspaceRelativePath(template.sshUser, template.targetDir)))
    const archiveAbs = yield* _(ensureArchiveExists(fs, path, resolved, command.archivePath))
    const archiveDir = path.dirname(archiveAbs)
    const archiveName = path.basename(archiveAbs)
    const workspacePath = workspacePathFromRelative(relative)

    return {
      fs,
      path,
      resolved,
      template,
      relative,
      archiveAbs,
      archiveDir,
      archiveName,
      workspacePath
    }
  })

const runScrapImport = (
  command: ScrapImportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const ctx = yield* _(loadScrapImportContext(command))
    yield* _(ensureSafeScrapImportWipe(command.wipe, ctx.template, ctx.relative))
    yield* _(logScrapImportPlan(ctx.resolved, ctx.template, ctx.archiveAbs, command.wipe))

    const script = buildScrapImportScript(ctx.archiveName, ctx.workspacePath, command.wipe)
    yield* _(
      runDockerScrap(ctx.resolved, "scrap import", [
        "--user",
        "1000:1000",
        "-v",
        `${ctx.template.volumeName}:/volume`,
        "-v",
        `${ctx.archiveDir}:/in:ro`,
        scrapImage,
        "sh",
        "-lc",
        script
      ])
    )

    yield* _(Effect.log("Scrap import complete."))
  }).pipe(Effect.asVoid)

// CHANGE: import workspace scrap (cache) into the docker home volume from a host archive
// WHY: restore installed dependencies and workspace state on a fresh machine/container volume
// QUOTE(ТЗ): "мог копировать скрап (кеш) от докер контейнеров"
// REF: issue-27
// SOURCE: n/a
// FORMAT THEOREM: import(p, a) → restored(workspace(p), a)
// PURITY: SHELL
// EFFECT: Effect<void, ScrapError, FileSystem | Path | CommandExecutor>
// INVARIANT: wipe=true never deletes /home/<sshUser> root (safety)
// COMPLEXITY: O(command + archive_size)
export const importScrap = (
  command: ScrapImportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    yield* _(ensureDockerDaemonAccess(process.cwd()))
    yield* _(runScrapImport(command))
  }).pipe(Effect.asVoid)
