import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { dockerGitSharedCacheVolumeName, dockerGitSharedCodexVolumeName, type TemplateConfig } from "../core/domain.js"
import { runDockerVolumeCreate, runDockerVolumeSeedFromDir } from "../shell/docker-volume.js"
import type { DockerCommandError } from "../shell/errors.js"
import { resolvePathFromCwd } from "./path-helpers.js"

type SharedVolumeSeedEnvironment = FileSystem.FileSystem | Path.Path | CommandExecutor

export const ensureSharedCodexVolumeReady = (
  cwd: string,
  config: Pick<TemplateConfig, "codexSharedAuthPath">
): Effect.Effect<void, DockerCommandError | PlatformError, SharedVolumeSeedEnvironment> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const sourceDir = resolvePathFromCwd(path, cwd, config.codexSharedAuthPath)

    yield* _(runDockerVolumeCreate(cwd, dockerGitSharedCacheVolumeName))
    yield* _(runDockerVolumeCreate(cwd, dockerGitSharedCodexVolumeName))

    const sourceExists = yield* _(fs.exists(sourceDir))
    if (!sourceExists) {
      return
    }

    yield* _(runDockerVolumeSeedFromDir(cwd, dockerGitSharedCodexVolumeName, sourceDir))
  }).pipe(Effect.asVoid)
