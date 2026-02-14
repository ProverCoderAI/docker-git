import { Effect } from "effect"

import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"

import type { ScrapExportCommand, ScrapImportCommand } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { ScrapArchiveInvalidError, ScrapArchiveNotFoundError } from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import {
  chunkManifestSuffix,
  decodeChunkManifest,
  listChunkParts,
  maxGitBlobBytes,
  removeChunkArtifacts,
  sumFileSizes,
  writeChunkManifest
} from "./scrap-chunks.js"
import { buildScrapTemplate, eitherToEffect, ensureSafeScrapImportWipe, runShell, shellEscape } from "./scrap-common.js"
import { deriveScrapWorkspaceRelativePath } from "./scrap-path.js"
import type { ScrapError, ScrapRequirements } from "./scrap-types.js"

const scrapImage = "alpine:3.20"

type CacheArchiveInput = {
  readonly baseAbs: string
  readonly partsAbs: ReadonlyArray<string>
}

const workspacePathFromRelative = (relative: string): string =>
  relative.length === 0 ? "/volume" : `/volume/${relative}`

const resolveCacheArchiveInput = (
  fs: Fs,
  path: PathService,
  projectDir: string,
  archivePath: string
): Effect.Effect<CacheArchiveInput, ScrapArchiveNotFoundError | ScrapArchiveInvalidError | PlatformError> =>
  Effect.gen(function*(_) {
    const baseAbs = resolvePathFromCwd(path, projectDir, archivePath)
    const exists = yield* _(fs.exists(baseAbs))
    if (exists) {
      const stat = yield* _(fs.stat(baseAbs))
      if (stat.type === "File") {
        return { baseAbs, partsAbs: [baseAbs] }
      }
    }

    const manifestAbs = `${baseAbs}${chunkManifestSuffix}`
    const manifestExists = yield* _(fs.exists(manifestAbs))
    if (!manifestExists) {
      return yield* _(Effect.fail(new ScrapArchiveNotFoundError({ path: baseAbs })))
    }

    const manifestText = yield* _(fs.readFileString(manifestAbs))
    const manifest = yield* _(decodeChunkManifest(manifestAbs, manifestText))
    if (manifest.parts.length === 0) {
      return yield* _(
        Effect.fail(new ScrapArchiveInvalidError({ path: manifestAbs, message: "manifest.parts is empty" }))
      )
    }

    const dir = path.dirname(baseAbs)
    const partsAbs = manifest.parts.map((part) => path.join(dir, part))
    for (const partAbs of partsAbs) {
      const partExists = yield* _(fs.exists(partAbs))
      if (!partExists) {
        return yield* _(Effect.fail(new ScrapArchiveNotFoundError({ path: partAbs })))
      }
    }

    return { baseAbs, partsAbs }
  })

const buildCacheExportScript = (volumeName: string, workspacePath: string, partsPrefix: string): string => {
  const volumeMount = `${volumeName}:/volume:ro`
  const innerScript = [
    "set -e",
    `SRC=${shellEscape(workspacePath)}`,
    "if [ ! -d \"$SRC\" ]; then echo \"Workspace dir not found: $SRC\" >&2; exit 2; fi",
    "tar czf - -C \"$SRC\" ."
  ].join("; ")

  return [
    "set -e",
    `docker run --rm --user 1000:1000 -v ${shellEscape(volumeMount)} ${scrapImage} sh -lc ${shellEscape(innerScript)}`,
    `| split -b ${maxGitBlobBytes} -d -a 5 - ${shellEscape(partsPrefix)}`
  ].join(" ")
}

export const exportScrapCache = (
  command: ScrapExportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(command.projectDir))
    const config = yield* _(readProjectConfig(resolved))
    const template = buildScrapTemplate(config)

    const relative = yield* _(eitherToEffect(deriveScrapWorkspaceRelativePath(template.sshUser, template.targetDir)))
    const workspacePath = workspacePathFromRelative(relative)

    const archiveAbs = resolvePathFromCwd(path, resolved, command.archivePath)
    const archiveDir = path.dirname(archiveAbs)
    const archiveBase = path.basename(archiveAbs)
    const partsPrefix = `${archiveAbs}.part`

    yield* _(fs.makeDirectory(archiveDir, { recursive: true }))
    yield* _(removeChunkArtifacts(fs, path, archiveAbs))
    yield* _(fs.remove(archiveAbs, { force: true }))

    yield* _(
      Effect.log(
        [
          `Project: ${resolved}`,
          "Mode: cache",
          `Volume: ${template.volumeName}`,
          `Workspace: ${template.targetDir}`,
          `Archive: ${archiveAbs} (+parts, max ${maxGitBlobBytes} bytes each)`
        ].join("\n")
      )
    )

    const script = buildCacheExportScript(template.volumeName, workspacePath, partsPrefix)
    yield* _(runShell(resolved, "scrap export cache", script))

    const partsAbs = yield* _(listChunkParts(fs, path, archiveAbs))
    const totalSize = yield* _(sumFileSizes(fs, partsAbs))
    yield* _(writeChunkManifest(fs, path, archiveAbs, totalSize, partsAbs))

    yield* _(Effect.log(`Scrap cache export complete: ${archiveBase}${chunkManifestSuffix}`))
  }).pipe(Effect.asVoid)

const buildCacheImportScript = (
  volumeName: string,
  workspacePath: string,
  wipe: boolean
): { readonly dockerRun: string; readonly innerScript: string } => {
  const wipeLine = wipe ? "rm -rf \"$DST\"" : ":"
  const innerScript = [
    "set -e",
    `DST=${shellEscape(workspacePath)}`,
    wipeLine,
    "mkdir -p \"$DST\"",
    "tar xzf - -C \"$DST\""
  ].join("; ")

  const volumeMount = `${volumeName}:/volume`
  const dockerRun = [
    "docker run --rm -i",
    "--user 1000:1000",
    `-v ${shellEscape(volumeMount)}`,
    scrapImage,
    "sh -lc",
    shellEscape(innerScript)
  ].join(" ")

  return { dockerRun, innerScript }
}

export const importScrapCache = (
  command: ScrapImportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(command.projectDir))
    const config = yield* _(readProjectConfig(resolved))
    const template = buildScrapTemplate(config)

    const relative = yield* _(eitherToEffect(deriveScrapWorkspaceRelativePath(template.sshUser, template.targetDir)))
    yield* _(ensureSafeScrapImportWipe(command.wipe, template, relative))
    const workspacePath = workspacePathFromRelative(relative)

    const archiveInput = yield* _(resolveCacheArchiveInput(fs, path, resolved, command.archivePath))

    yield* _(
      Effect.log(
        [
          `Project: ${resolved}`,
          "Mode: cache",
          `Volume: ${template.volumeName}`,
          `Workspace: ${template.targetDir}`,
          `Archive: ${archiveInput.baseAbs}`,
          `Wipe: ${command.wipe ? "yes" : "no"}`
        ].join("\n")
      )
    )

    const { dockerRun } = buildCacheImportScript(template.volumeName, workspacePath, command.wipe)
    const catArgs = archiveInput.partsAbs.map((p) => shellEscape(p)).join(" ")
    const script = ["set -e", `cat ${catArgs} | ${dockerRun}`].join("; ")
    yield* _(runShell(resolved, "scrap import cache", script))

    yield* _(Effect.log("Scrap cache import complete."))
  }).pipe(Effect.asVoid)
