import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { dockerGitSharedCacheVolumeName, dockerGitSharedCodexVolumeName, type TemplateConfig } from "../core/domain.js"
import { runDockerVolumeCreate } from "../shell/docker-volume.js"
import type { DockerCommandError } from "../shell/errors.js"

type SharedVolumeSeedEnvironment = CommandExecutor

export const ensureSharedCodexVolumeReady = (
  cwd: string,
  _config: Pick<TemplateConfig, "codexSharedAuthPath">
): Effect.Effect<void, DockerCommandError | PlatformError, SharedVolumeSeedEnvironment> =>
  Effect.gen(function*(_) {
    yield* _(runDockerVolumeCreate(cwd, dockerGitSharedCacheVolumeName))
    yield* _(runDockerVolumeCreate(cwd, dockerGitSharedCodexVolumeName))
  }).pipe(Effect.asVoid)
