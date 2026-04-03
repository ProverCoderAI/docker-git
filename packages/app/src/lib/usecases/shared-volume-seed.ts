/* jscpd:ignore-start */
import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import {
  dockerGitSharedCacheVolumeName,
  dockerGitSharedCodexVolumeName,
  resolveProjectBootstrapVolumeName,
  type TemplateConfig
} from "../core/domain.js"
import { runDockerVolumeCreate, runDockerVolumeReplaceFromDirectory } from "../shell/docker-volume.js"
import type { DockerCommandError } from "../shell/errors.js"
import { readFileStringIfPresent, statIfPresent, writeFileStringEnsuringParent } from "./volatile-files.js"

type SharedVolumeSeedEnvironment = CommandExecutor | FileSystem.FileSystem | Path.Path

const resolvePathFromBase = (
  path: Path.Path,
  baseDir: string,
  targetPath: string
): string => (path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath))

const copyDirRecursive = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourceDir: string,
  targetDir: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const info = yield* _(statIfPresent(fs, sourceDir))
    if (info === null || info.type !== "Directory") {
      return
    }

    yield* _(fs.makeDirectory(targetDir, { recursive: true }))
    const entries = yield* _(fs.readDirectory(sourceDir))
    for (const entry of entries) {
      const sourceEntry = path.join(sourceDir, entry)
      const targetEntry = path.join(targetDir, entry)
      const entryInfo = yield* _(statIfPresent(fs, sourceEntry))
      if (entryInfo === null) {
        continue
      }
      if (entryInfo.type === "Directory") {
        yield* _(copyDirRecursive(fs, path, sourceEntry, targetEntry))
      } else if (entryInfo.type === "File") {
        const sourceText = yield* _(readFileStringIfPresent(fs, sourceEntry))
        if (sourceText === null) {
          continue
        }
        yield* _(writeFileStringEnsuringParent(fs, path, targetEntry, sourceText))
      }
    }
  })

const copyFileIfPresent = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const info = yield* _(statIfPresent(fs, sourcePath))
    if (info === null || info.type !== "File") {
      return
    }
    const sourceText = yield* _(readFileStringIfPresent(fs, sourcePath))
    if (sourceText === null) {
      return
    }
    yield* _(writeFileStringEnsuringParent(fs, path, targetPath, sourceText))
  })

const copyCodexAuthFileIfPresent = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourceDir: string,
  targetDir: string,
  fileName: "auth.json" | "config.toml"
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  copyFileIfPresent(fs, path, path.join(sourceDir, fileName), path.join(targetDir, fileName))

const copyLabeledCodexFiles = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourceRoot: string,
  targetRoot: string,
  fileName: "auth.json" | "config.toml"
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const sourceInfo = yield* _(statIfPresent(fs, sourceRoot))
    if (sourceInfo === null || sourceInfo.type !== "Directory") {
      return
    }

    const entries = yield* _(fs.readDirectory(sourceRoot))
    for (const entry of entries) {
      const sourceEntry = path.join(sourceRoot, entry)
      const entryInfo = yield* _(statIfPresent(fs, sourceEntry))
      if (entryInfo === null || entryInfo.type !== "Directory") {
        continue
      }

      yield* _(copyCodexAuthFileIfPresent(fs, path, sourceEntry, path.join(targetRoot, entry), fileName))
    }
  })

type BootstrapSeedConfig = Pick<
  TemplateConfig,
  "authorizedKeysPath" | "envGlobalPath" | "envProjectPath" | "codexAuthPath" | "codexSharedAuthPath"
>

type BootstrapSnapshotSources = {
  readonly authorizedKeysSource: string
  readonly envGlobalSource: string
  readonly envProjectSource: string
  readonly codexAuthSource: string
  readonly codexSharedAuthSource: string
  readonly claudeAuthSource: string
}

type BootstrapSnapshotTargets = {
  readonly authorizedKeysTarget: string
  readonly envGlobalTarget: string
  readonly envProjectTarget: string
  readonly projectCodexTarget: string
  readonly projectClaudeTarget: string
  readonly sharedCodexTarget: string
}

const resolveBootstrapSnapshotSources = (
  path: Path.Path,
  projectDir: string,
  config: BootstrapSeedConfig
): BootstrapSnapshotSources => {
  const codexAuthSource = resolvePathFromBase(path, projectDir, config.codexAuthPath)
  return {
    authorizedKeysSource: resolvePathFromBase(path, projectDir, config.authorizedKeysPath),
    envGlobalSource: resolvePathFromBase(path, projectDir, config.envGlobalPath),
    envProjectSource: resolvePathFromBase(path, projectDir, config.envProjectPath),
    codexAuthSource,
    codexSharedAuthSource: resolvePathFromBase(path, projectDir, config.codexSharedAuthPath),
    claudeAuthSource: path.join(path.dirname(codexAuthSource), "claude")
  }
}

const resolveBootstrapSnapshotTargets = (
  path: Path.Path,
  stagingDir: string,
  config: BootstrapSeedConfig
): BootstrapSnapshotTargets => {
  const authorizedKeysBase = config.authorizedKeysPath.replaceAll("\\", "/").split("/").at(-1) ?? "authorized_keys"
  const envGlobalBase = config.envGlobalPath.replaceAll("\\", "/").split("/").at(-1) ?? "global.env"
  const envProjectBase = config.envProjectPath.replaceAll("\\", "/").split("/").at(-1) ?? "project.env"

  return {
    authorizedKeysTarget: path.join(stagingDir, "authorized-keys", authorizedKeysBase),
    envGlobalTarget: path.join(stagingDir, "env-global", envGlobalBase),
    envProjectTarget: path.join(stagingDir, "env-project", envProjectBase),
    projectCodexTarget: path.join(stagingDir, "project-auth", "codex"),
    projectClaudeTarget: path.join(stagingDir, "project-auth", "claude"),
    sharedCodexTarget: path.join(stagingDir, "shared-auth", "codex")
  }
}

const ensureBootstrapSnapshotLayout = (
  path: Path.Path,
  fs: FileSystem.FileSystem,
  targets: BootstrapSnapshotTargets
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    yield* _(fs.makeDirectory(path.dirname(targets.authorizedKeysTarget), { recursive: true }))
    yield* _(fs.makeDirectory(path.dirname(targets.envGlobalTarget), { recursive: true }))
    yield* _(fs.makeDirectory(path.dirname(targets.envProjectTarget), { recursive: true }))
    yield* _(fs.makeDirectory(targets.projectCodexTarget, { recursive: true }))
    yield* _(fs.makeDirectory(targets.projectClaudeTarget, { recursive: true }))
    yield* _(fs.makeDirectory(targets.sharedCodexTarget, { recursive: true }))
  })

const copyBootstrapSnapshotFiles = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sources: BootstrapSnapshotSources,
  targets: BootstrapSnapshotTargets
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    yield* _(copyFileIfPresent(fs, path, sources.authorizedKeysSource, targets.authorizedKeysTarget))
    yield* _(copyFileIfPresent(fs, path, sources.envGlobalSource, targets.envGlobalTarget))
    yield* _(copyFileIfPresent(fs, path, sources.envProjectSource, targets.envProjectTarget))
  })

const copyBootstrapSnapshotAuthDirs = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sources: BootstrapSnapshotSources,
  targets: BootstrapSnapshotTargets
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    yield* _(copyCodexAuthFileIfPresent(fs, path, sources.codexAuthSource, targets.projectCodexTarget, "auth.json"))
    yield* _(copyCodexAuthFileIfPresent(fs, path, sources.codexAuthSource, targets.projectCodexTarget, "config.toml"))
    yield* _(copyLabeledCodexFiles(fs, path, sources.codexAuthSource, targets.projectCodexTarget, "auth.json"))
    yield* _(copyLabeledCodexFiles(fs, path, sources.codexAuthSource, targets.projectCodexTarget, "config.toml"))
    yield* _(copyDirRecursive(fs, path, sources.claudeAuthSource, targets.projectClaudeTarget))
    yield* _(
      copyCodexAuthFileIfPresent(fs, path, sources.codexSharedAuthSource, targets.sharedCodexTarget, "auth.json")
    )
    yield* _(copyLabeledCodexFiles(fs, path, sources.codexSharedAuthSource, targets.sharedCodexTarget, "auth.json"))
  })

export const stageBootstrapSnapshot = (
  stagingDir: string,
  projectDir: string,
  config: BootstrapSeedConfig
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)

    const sources = resolveBootstrapSnapshotSources(path, projectDir, config)
    const targets = resolveBootstrapSnapshotTargets(path, stagingDir, config)

    yield* _(ensureBootstrapSnapshotLayout(path, fs, targets))
    yield* _(copyBootstrapSnapshotFiles(fs, path, sources, targets))
    yield* _(copyBootstrapSnapshotAuthDirs(fs, path, sources, targets))
  })

export const ensureProjectBootstrapVolumeReady = (
  projectDir: string,
  config: Pick<
    TemplateConfig,
    "volumeName" | "authorizedKeysPath" | "envGlobalPath" | "envProjectPath" | "codexAuthPath" | "codexSharedAuthPath"
  >
): Effect.Effect<void, DockerCommandError | PlatformError, SharedVolumeSeedEnvironment> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const bootstrapVolumeName = resolveProjectBootstrapVolumeName(config)
      yield* _(runDockerVolumeCreate(projectDir, bootstrapVolumeName))
      const stagingDir = yield* _(fs.makeTempDirectoryScoped({ prefix: "docker-git-bootstrap-" }))
      yield* _(stageBootstrapSnapshot(stagingDir, projectDir, config))
      yield* _(runDockerVolumeReplaceFromDirectory(projectDir, bootstrapVolumeName, stagingDir))
    }).pipe(Effect.asVoid)
  )

export const ensureSharedCodexVolumeReady = (
  cwd: string,
  config: Pick<
    TemplateConfig,
    "volumeName" | "authorizedKeysPath" | "envGlobalPath" | "envProjectPath" | "codexAuthPath" | "codexSharedAuthPath"
  >
): Effect.Effect<void, DockerCommandError | PlatformError, SharedVolumeSeedEnvironment> =>
  Effect.gen(function*(_) {
    yield* _(runDockerVolumeCreate(cwd, dockerGitSharedCacheVolumeName))
    yield* _(runDockerVolumeCreate(cwd, dockerGitSharedCodexVolumeName))
    yield* _(ensureProjectBootstrapVolumeReady(cwd, config))
  }).pipe(Effect.asVoid)
/* jscpd:ignore-end */
