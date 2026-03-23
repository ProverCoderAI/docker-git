import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import { ensureDockerDaemonAccess } from "../shell/docker.js"
import type { DockerAccessError, DockerCommandError } from "../shell/errors.js"
import { renderError } from "./errors.js"
import { forEachProjectStatus, loadProjectIndex, renderProjectStatusHeader } from "./projects-core.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"

// CHANGE: provide an "apply all" helper for docker-git managed projects
// WHY: allow applying updated docker-git config to every known project in one command
// QUOTE(ТЗ): "Сделать команду которая сама на все контейнеры применит новые настройки"
// REF: issue-164
// SOURCE: n/a
// FORMAT THEOREM: ∀p ∈ Projects: applyAll(p) → updated(p) ∨ warned(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | DockerAccessError, FileSystem | Path | CommandExecutor>
// INVARIANT: continues applying to other projects when one docker compose up fails with DockerCommandError
// COMPLEXITY: O(n) where n = |projects|
export const applyAllDockerGitProjects: Effect.Effect<
  void,
  PlatformError | DockerAccessError,
  FileSystem | Path | CommandExecutor
> = pipe(
  ensureDockerDaemonAccess(process.cwd()),
  Effect.zipRight(loadProjectIndex()),
  Effect.flatMap((index) =>
    index === null
      ? Effect.void
      : forEachProjectStatus(index.configPaths, (status) =>
        pipe(
          Effect.log(renderProjectStatusHeader(status)),
          Effect.zipRight(
            runDockerComposeUpWithPortCheck(status.projectDir).pipe(
              Effect.catchTag("DockerCommandError", (error: DockerCommandError) =>
                Effect.logWarning(
                  `apply failed for ${status.projectDir}: ${
                    renderError(error)
                  }. Check the project docker-compose config (e.g. env files for merge conflicts, port conflicts in docker-compose.yml config) and retry.`
                )),
              Effect.catchTag("ConfigNotFoundError", (error) =>
                Effect.logWarning(
                  `Skipping ${status.projectDir}: ${renderError(error)}`
                )),
              Effect.catchTag("ConfigDecodeError", (error) =>
                Effect.logWarning(
                  `Skipping ${status.projectDir}: ${renderError(error)}`
                )),
              Effect.catchTag("PortProbeError", (error) =>
                Effect.logWarning(
                  `Skipping ${status.projectDir}: ${renderError(error)}`
                )),
              Effect.catchTag("FileExistsError", (error) =>
                Effect.logWarning(
                  `Skipping ${status.projectDir}: ${renderError(error)}`
                )),
              Effect.asVoid
            )
          )
        ))
  ),
  Effect.asVoid
)
