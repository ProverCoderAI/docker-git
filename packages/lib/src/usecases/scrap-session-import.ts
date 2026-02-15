import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"
import { Effect } from "effect"

import type { ProjectConfig, ScrapImportCommand } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { ScrapArchiveNotFoundError } from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { decodeChunkManifest } from "./scrap-chunks.js"
import {
  buildScrapTemplate,
  eitherToEffect,
  ensureSafeScrapImportWipe,
  runDockerExec,
  runShell,
  shellEscape
} from "./scrap-common.js"
import { deriveScrapWorkspaceRelativePath } from "./scrap-path.js"
import { decodeSessionManifest, type SessionManifest } from "./scrap-session-manifest.js"
import type { ScrapError, ScrapRequirements } from "./scrap-types.js"

type SessionImportContext = {
  readonly fs: Fs
  readonly path: PathService
  readonly resolved: string
  readonly config: ProjectConfig
  readonly template: ReturnType<typeof buildScrapTemplate>
  readonly snapshotDir: string
  readonly manifest: SessionManifest
}

const resolveSessionSnapshotDir = (
  fs: Fs,
  path: PathService,
  projectDir: string,
  archivePath: string
): Effect.Effect<string, ScrapArchiveNotFoundError | PlatformError> =>
  Effect.gen(function*(_) {
    const baseAbs = resolvePathFromCwd(path, projectDir, archivePath)
    const exists = yield* _(fs.exists(baseAbs))
    if (!exists) {
      return yield* _(Effect.fail(new ScrapArchiveNotFoundError({ path: baseAbs })))
    }

    const baseStat = yield* _(fs.stat(baseAbs))
    if (baseStat.type !== "Directory") {
      return yield* _(Effect.fail(new ScrapArchiveNotFoundError({ path: baseAbs })))
    }

    const direct = yield* _(fs.exists(path.join(baseAbs, "manifest.json")))
    if (direct) {
      return baseAbs
    }

    const entries = yield* _(fs.readDirectory(baseAbs))
    const sorted = entries.toSorted((a, b) => b.localeCompare(a))
    for (const entry of sorted) {
      const dirAbs = path.join(baseAbs, entry)
      const stat = yield* _(fs.stat(dirAbs))
      if (stat.type !== "Directory") {
        continue
      }
      const hasManifest = yield* _(fs.exists(path.join(dirAbs, "manifest.json")))
      if (hasManifest) {
        return dirAbs
      }
    }

    return yield* _(Effect.fail(new ScrapArchiveNotFoundError({ path: baseAbs })))
  })

const loadSessionImportContext = (
  command: ScrapImportCommand
): Effect.Effect<SessionImportContext, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(command.projectDir))
    const config = yield* _(readProjectConfig(resolved))
    const template = buildScrapTemplate(config)

    const relative = yield* _(eitherToEffect(deriveScrapWorkspaceRelativePath(template.sshUser, template.targetDir)))
    yield* _(ensureSafeScrapImportWipe(command.wipe, template, relative))

    const snapshotDir = yield* _(resolveSessionSnapshotDir(fs, path, resolved, command.archivePath))
    const manifestPath = path.join(snapshotDir, "manifest.json")
    const manifestText = yield* _(fs.readFileString(manifestPath))
    const manifest = yield* _(decodeSessionManifest(manifestPath, manifestText))

    return { fs, path, resolved, config, template, snapshotDir, manifest }
  })

const resolveSnapshotPartsAbs = (
  ctx: SessionImportContext,
  chunksFile: string
): Effect.Effect<ReadonlyArray<string>, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const chunksAbs = ctx.path.join(ctx.snapshotDir, chunksFile)
    const chunksText = yield* _(ctx.fs.readFileString(chunksAbs))
    const chunks = yield* _(decodeChunkManifest(chunksAbs, chunksText))
    const partsAbs = chunks.parts.map((part) => ctx.path.join(ctx.snapshotDir, part))
    for (const partAbs of partsAbs) {
      const partExists = yield* _(ctx.fs.exists(partAbs))
      if (!partExists) {
        return yield* _(Effect.fail(new ScrapArchiveNotFoundError({ path: partAbs })))
      }
    }
    return partsAbs
  })

const restoreHostEnvFiles = (ctx: SessionImportContext): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const restore = (snapshotFileName: string | null | undefined, dstAbs: string, label: string) =>
      Effect.gen(function*(__) {
        const name = snapshotFileName?.trim() ?? ""
        if (name.length === 0 || name === "null") {
          return
        }

        const srcAbs = ctx.path.join(ctx.snapshotDir, name)
        const exists = yield* __(ctx.fs.exists(srcAbs))
        if (!exists) {
          return
        }

        const contents = yield* __(ctx.fs.readFileString(srcAbs))
        yield* __(ctx.fs.makeDirectory(ctx.path.dirname(dstAbs), { recursive: true }))
        yield* __(ctx.fs.writeFileString(dstAbs, contents))
        yield* __(Effect.log(`Restored ${label}: ${dstAbs}`))
      })

    const envGlobalAbs = resolvePathFromCwd(ctx.path, ctx.resolved, ctx.config.template.envGlobalPath)
    const envProjectAbs = resolvePathFromCwd(ctx.path, ctx.resolved, ctx.config.template.envProjectPath)

    yield* _(restore(ctx.manifest.artifacts.envGlobalFile, envGlobalAbs, "env-global"))
    yield* _(restore(ctx.manifest.artifacts.envProjectFile, envProjectAbs, "env-project"))
  }).pipe(Effect.asVoid)

const prepareRepoForImport = (
  ctx: SessionImportContext,
  wipe: boolean
): Effect.Effect<void, ScrapError, ScrapRequirements> => {
  const wipeLine = wipe ? `rm -rf ${shellEscape(ctx.template.targetDir)}` : ":"
  const gitDir = `${ctx.template.targetDir}/.git`
  const prepScript = [
    "set -e",
    wipeLine,
    `mkdir -p ${shellEscape(ctx.template.targetDir)}`,
    `if [ ! -d ${shellEscape(gitDir)} ]; then`,
    `  PARENT=$(dirname ${shellEscape(ctx.template.targetDir)})`,
    "  mkdir -p \"$PARENT\"",
    `  git clone ${shellEscape(ctx.manifest.repo.originUrl)} ${shellEscape(ctx.template.targetDir)}`,
    "fi",
    `cd ${shellEscape(ctx.template.targetDir)}`,
    `SAFE=${shellEscape(ctx.template.targetDir)}`,
    "git -c safe.directory=\"$SAFE\" fetch --all --prune",
    `git -c safe.directory="$SAFE" checkout --detach ${shellEscape(ctx.manifest.repo.head)}`,
    `git -c safe.directory="$SAFE" reset --hard ${shellEscape(ctx.manifest.repo.head)}`,
    "git -c safe.directory=\"$SAFE\" clean -fd",
    // Remove common heavy caches that are easy to rebuild with internet access.
    "find . -name node_modules -type d -prune -exec rm -rf '{}' + 2>/dev/null || true"
  ].join("\n")

  return runDockerExec(
    ctx.resolved,
    "scrap session prepare repo",
    ctx.template.containerName,
    prepScript,
    ctx.template.sshUser
  )
}

const applyWorktreePatch = (ctx: SessionImportContext): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const patchPartsAbs = yield* _(resolveSnapshotPartsAbs(ctx, ctx.manifest.artifacts.worktreePatchChunks))
    const patchCatArgs = patchPartsAbs.map((p) => shellEscape(p)).join(" ")
    const applyInner = [
      "set -e",
      `cd ${shellEscape(ctx.template.targetDir)}`,
      `SAFE=${shellEscape(ctx.template.targetDir)}`,
      "git -c safe.directory=\"$SAFE\" apply --allow-empty --binary --whitespace=nowarn -"
    ].join("; ")
    const applyScript = [
      "set -e",
      `cat ${patchCatArgs} | gzip -dc | docker exec -i -u ${shellEscape(ctx.template.sshUser)} ${
        shellEscape(
          ctx.template.containerName
        )
      } sh -c ${
        shellEscape(
          applyInner
        )
      }`
    ].join("; ")
    yield* _(runShell(ctx.resolved, "scrap session apply patch", applyScript))
  }).pipe(Effect.asVoid)

const restoreTarChunksIntoContainerDir = (
  ctx: SessionImportContext,
  dst: string,
  chunksFile: string,
  label: string
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const partsAbs = yield* _(resolveSnapshotPartsAbs(ctx, chunksFile))
    const catArgs = partsAbs.map((partAbs) => shellEscape(partAbs)).join(" ")
    const inner = [
      "set -e",
      `DST=${shellEscape(dst)}`,
      "mkdir -p \"$DST\"",
      // Clearing contents instead of removing the directory keeps mount points (like shared auth volumes) intact.
      "find \"$DST\" -mindepth 1 -maxdepth 1 -exec rm -rf '{}' + 2>/dev/null || true",
      "tar xzf - -C \"$DST\""
    ].join("; ")
    const script = [
      "set -e",
      `cat ${catArgs} | docker exec -i -u ${shellEscape(ctx.template.sshUser)} ${
        shellEscape(
          ctx.template.containerName
        )
      } sh -c ${shellEscape(inner)}`
    ].join("; ")
    yield* _(runShell(ctx.resolved, label, script))
  }).pipe(Effect.asVoid)

const runRebuildCommands = (ctx: SessionImportContext): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const commands = ctx.manifest.rebuild.commands
    if (commands.length === 0) {
      return
    }

    for (const command of commands) {
      const trimmed = command.trim()
      if (trimmed.length === 0) {
        continue
      }
      yield* _(Effect.log(`Rebuilding: ${trimmed}`))
      const script = `set -e; cd ${shellEscape(ctx.template.targetDir)}; ${trimmed}`
      yield* _(
        runDockerExec(ctx.resolved, "scrap session rebuild", ctx.template.containerName, script, ctx.template.sshUser)
      )
    }
  }).pipe(Effect.asVoid)

export const importScrapSession = (
  command: ScrapImportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    const ctx = yield* _(loadSessionImportContext(command))
    yield* _(
      Effect.log(
        [
          `Project: ${ctx.resolved}`,
          "Mode: session",
          `Snapshot: ${ctx.snapshotDir}`,
          `Container: ${ctx.template.containerName}`,
          `Workspace: ${ctx.template.targetDir}`,
          `Repo: ${ctx.manifest.repo.originUrl} @ ${ctx.manifest.repo.head}`
        ].join("\n")
      )
    )

    yield* _(restoreHostEnvFiles(ctx))
    yield* _(prepareRepoForImport(ctx, command.wipe))
    yield* _(applyWorktreePatch(ctx))

    yield* _(
      restoreTarChunksIntoContainerDir(
        ctx,
        ctx.template.codexHome,
        ctx.manifest.artifacts.codexChunks,
        "scrap session restore codex"
      )
    )

    const codexSharedHome = `${ctx.template.codexHome}-shared`
    yield* _(
      restoreTarChunksIntoContainerDir(
        ctx,
        codexSharedHome,
        ctx.manifest.artifacts.codexSharedChunks,
        "scrap session restore codex-shared"
      )
    )

    yield* _(runRebuildCommands(ctx))
    yield* _(Effect.log("Scrap session import complete."))
  }).pipe(Effect.asVoid)
