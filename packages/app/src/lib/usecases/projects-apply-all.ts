import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { ApplyAllCommand } from "../core/domain.js"
import { ensureDockerDaemonAccess, runDockerPsNames } from "../shell/docker.js"
import type { CommandFailedError, DockerAccessError, DockerCommandError } from "../shell/errors.js"
import { renderError } from "./errors.js"
import {
  forEachProjectStatus,
  loadProjectIndex,
  type ProjectIndex,
  renderProjectStatusHeader
} from "./projects-core.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"

// CHANGE: provide an "apply all" helper for docker-git managed projects; support --active flag to filter by running containers
// WHY: allow applying updated docker-git config to every known project in one command; --active restricts to currently running containers only
// QUOTE(ТЗ): "Сделать команду которая сама на все контейнеры применит новые настройки"
// QUOTE(ТЗ): "сделать это возможным через атрибут --active применять только к активным контейнерам, а не ко всем"
// REF: issue-164, issue-185
// SOURCE: n/a
// FORMAT THEOREM: ∀p ∈ Projects: applyAll(p) → updated(p) ∨ warned(p); activeOnly=true → ∀p ∈ result: running(container(p))
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | DockerAccessError | CommandFailedError, FileSystem | Path | CommandExecutor>
// INVARIANT: continues applying to other projects when one docker compose up fails with DockerCommandError; when activeOnly=true skips non-running containers
// COMPLEXITY: O(n) where n = |projects|

type RunningNames = ReadonlyArray<string> | null

const applyToProjects = (
  index: ProjectIndex,
  runningNames: RunningNames
) =>
  forEachProjectStatus(
    index.configPaths,
    (status) =>
      runningNames !== null && !runningNames.includes(status.config.template.containerName)
        ? Effect.log(`Skipping ${status.projectDir}: container is not running`)
        : pipe(
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
        )
  )

export const applyAllDockerGitProjects = (
  command: ApplyAllCommand
): Effect.Effect<
  void,
  PlatformError | DockerAccessError | CommandFailedError,
  FileSystem | Path | CommandExecutor
> =>
  pipe(
    ensureDockerDaemonAccess(process.cwd()),
    Effect.zipRight(loadProjectIndex()),
    Effect.flatMap((index) => {
      if (index === null) {
        return Effect.void
      }
      if (!command.activeOnly) {
        return applyToProjects(index, null)
      }
      return pipe(
        runDockerPsNames(process.cwd()),
        Effect.flatMap((runningNames) => applyToProjects(index, runningNames))
      )
    }),
    Effect.asVoid
  )
