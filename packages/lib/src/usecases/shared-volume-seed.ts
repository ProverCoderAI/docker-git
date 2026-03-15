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
import {
  runDockerVolumeCreate,
  runDockerVolumeReplaceFromDirectory
} from "../shell/docker-volume.js"
import type { DockerCommandError } from "../shell/errors.js"

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
    const exists = yield* _(fs.exists(sourceDir))
    if (!exists) {
      return
    }
    const info = yield* _(fs.stat(sourceDir))
    if (info.type !== "Directory") {
      return
    }

    yield* _(fs.makeDirectory(targetDir, { recursive: true }))
    const entries = yield* _(fs.readDirectory(sourceDir))
    for (const entry of entries) {
      const sourceEntry = path.join(sourceDir, entry)
      const targetEntry = path.join(targetDir, entry)
      const entryInfo = yield* _(fs.stat(sourceEntry))
      if (entryInfo.type === "Directory") {
        yield* _(copyDirRecursive(fs, path, sourceEntry, targetEntry))
      } else if (entryInfo.type === "File") {
        yield* _(fs.makeDirectory(path.dirname(targetEntry), { recursive: true }))
        yield* _(fs.copyFile(sourceEntry, targetEntry))
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
    const exists = yield* _(fs.exists(sourcePath))
    if (!exists) {
      return
    }
    const info = yield* _(fs.stat(sourcePath))
    if (info.type !== "File") {
      return
    }
    yield* _(fs.makeDirectory(path.dirname(targetPath), { recursive: true }))
    yield* _(fs.copyFile(sourcePath, targetPath))
  })

const stageBootstrapSnapshot = (
  stagingDir: string,
  projectDir: string,
  config: Pick<
    TemplateConfig,
    "authorizedKeysPath" | "envGlobalPath" | "envProjectPath" | "codexAuthPath" | "codexSharedAuthPath"
  >
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)

    const authorizedKeysSource = resolvePathFromBase(path, projectDir, config.authorizedKeysPath)
    const envGlobalSource = resolvePathFromBase(path, projectDir, config.envGlobalPath)
    const envProjectSource = resolvePathFromBase(path, projectDir, config.envProjectPath)
    const codexAuthSource = resolvePathFromBase(path, projectDir, config.codexAuthPath)
    const codexSharedAuthSource = resolvePathFromBase(path, projectDir, config.codexSharedAuthPath)
    const claudeAuthSource = path.join(path.dirname(codexAuthSource), "claude")

    const authorizedKeysBase = config.authorizedKeysPath.replaceAll("\\", "/").split("/").at(-1) ?? "authorized_keys"
    const envGlobalBase = config.envGlobalPath.replaceAll("\\", "/").split("/").at(-1) ?? "global.env"
    const envProjectBase = config.envProjectPath.replaceAll("\\", "/").split("/").at(-1) ?? "project.env"

    yield* _(fs.makeDirectory(path.join(stagingDir, "authorized-keys"), { recursive: true }))
    yield* _(fs.makeDirectory(path.join(stagingDir, "env-global"), { recursive: true }))
    yield* _(fs.makeDirectory(path.join(stagingDir, "env-project"), { recursive: true }))
    yield* _(fs.makeDirectory(path.join(stagingDir, "project-auth", "codex"), { recursive: true }))
    yield* _(fs.makeDirectory(path.join(stagingDir, "project-auth", "claude"), { recursive: true }))
    yield* _(fs.makeDirectory(path.join(stagingDir, "shared-auth", "codex"), { recursive: true }))

    yield* _(
      copyFileIfPresent(
        fs,
        path,
        authorizedKeysSource,
        path.join(stagingDir, "authorized-keys", authorizedKeysBase)
      )
    )
    yield* _(
      copyFileIfPresent(
        fs,
        path,
        envGlobalSource,
        path.join(stagingDir, "env-global", envGlobalBase)
      )
    )
    yield* _(
      copyFileIfPresent(
        fs,
        path,
        envProjectSource,
        path.join(stagingDir, "env-project", envProjectBase)
      )
    )
    yield* _(copyDirRecursive(fs, path, codexAuthSource, path.join(stagingDir, "project-auth", "codex")))
    yield* _(copyDirRecursive(fs, path, claudeAuthSource, path.join(stagingDir, "project-auth", "claude")))
    yield* _(copyDirRecursive(fs, path, codexSharedAuthSource, path.join(stagingDir, "shared-auth", "codex")))
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
