import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import { runDockerComposeDown } from "../shell/docker.js"
import type { DockerCommandError } from "../shell/errors.js"
import { renderError } from "./errors.js"
import {
  loadProjectIndex,
  loadProjectStatus,
  type ProjectStatus,
  renderProjectStatusHeader,
  skipWithWarning
} from "./projects-core.js"

// CHANGE: provide a "stop all" helper for docker-git managed projects
// WHY: allow quickly stopping all running docker-git containers from the CLI/TUI
// QUOTE(ТЗ): "Выведи сюда возможность убивать все контейнеры"
// REF: user-request-2026-02-06-stop-all
// SOURCE: n/a
// FORMAT THEOREM: ∀p ∈ Projects: downAll(p) → stopped(p) ∨ warned(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: continues stopping other projects when one docker compose down fails with DockerCommandError
// COMPLEXITY: O(n) where n = |projects|
export const downAllDockerGitProjects: Effect.Effect<
  void,
  PlatformError,
  FileSystem | Path | CommandExecutor
> = pipe(
  loadProjectIndex(),
  Effect.flatMap((index) =>
    index === null
      ? Effect.void
      : Effect.gen(function*(_) {
        for (const configPath of index.configPaths) {
          const status = yield* _(
            loadProjectStatus(configPath).pipe(
              Effect.matchEffect({
                onFailure: skipWithWarning<ProjectStatus>(configPath),
                onSuccess: (value) => Effect.succeed(value)
              })
            )
          )
          if (status === null) {
            continue
          }

          yield* _(Effect.log(renderProjectStatusHeader(status)))
          yield* _(
            runDockerComposeDown(status.projectDir).pipe(
              Effect.catchTag("DockerCommandError", (error: DockerCommandError) =>
                Effect.logWarning(
                  `docker compose down failed for ${status.projectDir}: ${renderError(error)}`
                )
              )
            )
          )
        }
      })
  ),
  Effect.asVoid
)

