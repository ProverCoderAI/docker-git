import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"
import { Effect } from "effect"

import type { ProjectConfig, ScrapExportCommand } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { resolveBaseDir } from "../shell/paths.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import {
  listChunkParts,
  maxGitBlobBytes,
  removeChunkArtifacts,
  sumFileSizes,
  writeChunkManifest
} from "./scrap-chunks.js"
import type { ScrapTemplate } from "./scrap-common.js"
import { buildScrapTemplate, runDockerExecCapture, runShell, shellEscape } from "./scrap-common.js"
import type { SessionManifest } from "./scrap-session-manifest.js"
import type { ScrapError, ScrapRequirements } from "./scrap-types.js"

type SessionRepoInfo = SessionManifest["repo"]

type SessionExportContext = {
  readonly fs: Fs
  readonly path: PathService
  readonly resolved: string
  readonly config: ProjectConfig
  readonly template: ScrapTemplate
  readonly snapshotId: string
  readonly snapshotDir: string
}

type HostEnvArtifacts = {
  readonly envGlobalFile: string | null
  readonly envProjectFile: string | null
}

type SessionManifestInput = {
  readonly repo: SessionRepoInfo
  readonly patchChunksPath: string
  readonly codexChunksPath: string
  readonly codexSharedChunksPath: string
  readonly hostEnv: HostEnvArtifacts
  readonly rebuildCommands: ReadonlyArray<string>
}

const formatSnapshotId = (now: Date): string => {
  const year = String(now.getUTCFullYear()).padStart(4, "0")
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  const day = String(now.getUTCDate()).padStart(2, "0")
  const hour = String(now.getUTCHours()).padStart(2, "0")
  const min = String(now.getUTCMinutes()).padStart(2, "0")
  const sec = String(now.getUTCSeconds()).padStart(2, "0")
  return `${year}${month}${day}T${hour}${min}${sec}Z`
}

const loadSessionExportContext = (
  command: ScrapExportCommand
): Effect.Effect<SessionExportContext, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(command.projectDir))
    const config = yield* _(readProjectConfig(resolved))
    const template = buildScrapTemplate(config)

    const archiveRootAbs = resolvePathFromCwd(path, resolved, command.archivePath)
    const snapshotId = formatSnapshotId(new Date())
    const snapshotDir = path.join(archiveRootAbs, snapshotId)
    yield* _(fs.makeDirectory(snapshotDir, { recursive: true }))

    return { fs, path, resolved, config, template, snapshotId, snapshotDir }
  })

const captureRepoInfo = (
  ctx: SessionExportContext
): Effect.Effect<SessionRepoInfo, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const base = `set -e; cd ${shellEscape(ctx.template.targetDir)};`
    const capture = (label: string, cmd: string) =>
      runDockerExecCapture(ctx.resolved, label, ctx.template.containerName, `${base} ${cmd}`).pipe(
        Effect.map((value) => value.trim())
      )

    const head = yield* _(capture("scrap session rev-parse", "git rev-parse HEAD"))
    const branch = yield* _(capture("scrap session branch", "git rev-parse --abbrev-ref HEAD"))
    const originUrl = yield* _(capture("scrap session origin", "git remote get-url origin"))
    return { originUrl, head, branch }
  })

const exportHostEnvFiles = (
  ctx: SessionExportContext
): Effect.Effect<HostEnvArtifacts, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const copyIfExists = (srcAbs: string, dstName: string) =>
      Effect.gen(function*(__) {
        const exists = yield* __(ctx.fs.exists(srcAbs))
        if (!exists) {
          return null
        }
        const contents = yield* __(ctx.fs.readFileString(srcAbs))
        const dstAbs = ctx.path.join(ctx.snapshotDir, dstName)
        yield* __(ctx.fs.writeFileString(dstAbs, contents))
        return dstName
      })

    const envGlobalAbs = resolvePathFromCwd(ctx.path, ctx.resolved, ctx.config.template.envGlobalPath)
    const envProjectAbs = resolvePathFromCwd(ctx.path, ctx.resolved, ctx.config.template.envProjectPath)

    const envGlobalFile = yield* _(copyIfExists(envGlobalAbs, "env-global.env"))
    const envProjectFile = yield* _(copyIfExists(envProjectAbs, "env-project.env"))

    return { envGlobalFile, envProjectFile }
  })

const detectRebuildCommands = (
  ctx: SessionExportContext
): Effect.Effect<ReadonlyArray<string>, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const base = `set -e; cd ${shellEscape(ctx.template.targetDir)};`
    const script = [
      base,
      // Priority: pnpm > npm > yarn. Keep commands deterministic and rebuildable.
      "if [ -f pnpm-lock.yaml ]; then echo 'pnpm install --frozen-lockfile'; exit 0; fi",
      "if [ -f package-lock.json ]; then echo 'npm ci'; exit 0; fi",
      "if [ -f yarn.lock ]; then echo 'yarn install --frozen-lockfile'; exit 0; fi",
      "exit 0"
    ].join(" ")

    const output = yield* _(
      runDockerExecCapture(ctx.resolved, "scrap session detect rebuild", ctx.template.containerName, script)
    )

    const command = output.trim()
    return command.length > 0 ? [command] : []
  })

const exportWorktreePatchChunks = (
  ctx: SessionExportContext
): Effect.Effect<string, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const patchAbs = ctx.path.join(ctx.snapshotDir, "worktree.patch.gz")
    const patchPartsPrefix = `${patchAbs}.part`
    yield* _(removeChunkArtifacts(ctx.fs, ctx.path, patchAbs))

    const patchInner = [
      "set -e",
      `cd ${shellEscape(ctx.template.targetDir)}`,
      "TMP_INDEX=$(mktemp)",
      "trap 'rm -f \"$TMP_INDEX\"' EXIT",
      "GIT_INDEX_FILE=\"$TMP_INDEX\" git read-tree HEAD",
      "GIT_INDEX_FILE=\"$TMP_INDEX\" git add -A",
      "GIT_INDEX_FILE=\"$TMP_INDEX\" git diff --cached --binary --no-color"
    ].join("; ")

    const patchScript = [
      "set -e",
      `docker exec ${shellEscape(ctx.template.containerName)} sh -lc ${shellEscape(patchInner)}`,
      "| gzip -c",
      `| split -b ${maxGitBlobBytes} -d -a 5 - ${shellEscape(patchPartsPrefix)}`
    ].join(" ")
    yield* _(runShell(ctx.resolved, "scrap export session patch", patchScript))

    const partsAbs = yield* _(listChunkParts(ctx.fs, ctx.path, patchAbs))
    const totalSize = yield* _(sumFileSizes(ctx.fs, partsAbs))
    return yield* _(writeChunkManifest(ctx.fs, ctx.path, patchAbs, totalSize, partsAbs))
  })

const exportContainerDirChunks = (
  ctx: SessionExportContext,
  srcDir: string,
  archiveName: string,
  label: string
): Effect.Effect<string, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const archiveAbs = ctx.path.join(ctx.snapshotDir, archiveName)
    const partsPrefix = `${archiveAbs}.part`
    yield* _(removeChunkArtifacts(ctx.fs, ctx.path, archiveAbs))

    const inner = [
      "set -e",
      `SRC=${shellEscape(srcDir)}`,
      "mkdir -p \"$SRC\"",
      "tar czf - -C \"$SRC\" ."
    ].join("; ")

    const script = [
      "set -e",
      `docker exec ${shellEscape(ctx.template.containerName)} sh -lc ${shellEscape(inner)}`,
      `| split -b ${maxGitBlobBytes} -d -a 5 - ${shellEscape(partsPrefix)}`
    ].join(" ")
    yield* _(runShell(ctx.resolved, label, script))

    const partsAbs = yield* _(listChunkParts(ctx.fs, ctx.path, archiveAbs))
    const totalSize = yield* _(sumFileSizes(ctx.fs, partsAbs))
    return yield* _(writeChunkManifest(ctx.fs, ctx.path, archiveAbs, totalSize, partsAbs))
  })

const writeSessionManifest = (
  ctx: SessionExportContext,
  input: SessionManifestInput
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const manifest: SessionManifest = {
      schemaVersion: 1,
      mode: "session",
      snapshotId: ctx.snapshotId,
      createdAtUtc: new Date().toISOString(),
      repo: input.repo,
      artifacts: {
        worktreePatchChunks: ctx.path.basename(input.patchChunksPath),
        codexChunks: ctx.path.basename(input.codexChunksPath),
        codexSharedChunks: ctx.path.basename(input.codexSharedChunksPath),
        envGlobalFile: input.hostEnv.envGlobalFile,
        envProjectFile: input.hostEnv.envProjectFile
      },
      rebuild: {
        commands: [...input.rebuildCommands]
      }
    }
    const manifestPath = ctx.path.join(ctx.snapshotDir, "manifest.json")
    yield* _(ctx.fs.writeFileString(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`))
  }).pipe(Effect.asVoid)

export const exportScrapSession = (
  command: ScrapExportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const ctx = yield* _(loadSessionExportContext(command))
    yield* _(
      Effect.log(
        [
          `Project: ${ctx.resolved}`,
          "Mode: session",
          `Container: ${ctx.template.containerName}`,
          `Workspace: ${ctx.template.targetDir}`,
          `Output: ${ctx.snapshotDir}`
        ].join("\n")
      )
    )

    const repo = yield* _(captureRepoInfo(ctx))
    const hostEnv = yield* _(exportHostEnvFiles(ctx))
    const rebuildCommands = yield* _(detectRebuildCommands(ctx))

    const patchChunksPath = yield* _(exportWorktreePatchChunks(ctx))
    const codexChunksPath = yield* _(
      exportContainerDirChunks(ctx, ctx.template.codexHome, "codex.tar.gz", "scrap export session codex")
    )

    const codexSharedHome = `${ctx.template.codexHome}-shared`
    const codexSharedChunksPath = yield* _(
      exportContainerDirChunks(ctx, codexSharedHome, "codex-shared.tar.gz", "scrap export session codex-shared")
    )

    yield* _(
      writeSessionManifest(ctx, {
        repo,
        patchChunksPath,
        codexChunksPath,
        codexSharedChunksPath,
        hostEnv,
        rebuildCommands
      })
    )
    yield* _(Effect.log("Scrap session export complete."))
  }).pipe(Effect.asVoid)
