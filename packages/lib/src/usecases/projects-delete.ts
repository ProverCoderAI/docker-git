import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import { deriveRepoPathParts } from "../core/domain.js"
import { runCommandWithExitCodes } from "../shell/command-runner.js"
import { runDockerComposeDownVolumes } from "../shell/docker.js"
import { CommandFailedError, type DockerCommandError } from "../shell/errors.js"
import { renderError } from "./errors.js"
import { defaultProjectsRoot } from "./menu-helpers.js"
import type { ProjectItem } from "./projects-core.js"
import { autoSyncState } from "./state-repo.js"

const isWithinProjectsRoot = (path: Path.Path, root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  if (relative.length === 0) {
    return false
  }
  if (relative === "..") {
    return false
  }
  if (relative.startsWith(`..${path.sep}`)) {
    return false
  }
  return true
}

const removeContainerByName = (
  cwd: string,
  containerName: string
): Effect.Effect<void, never, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: ["rm", "-f", containerName]
    },
    [0],
    (exitCode) => new CommandFailedError({ command: `docker rm -f ${containerName}`, exitCode })
  ).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.logWarning(`docker rm -f fallback failed for ${containerName}: ${renderError(error)}`),
      onSuccess: () => Effect.log(`Removed container: ${containerName}`)
    }),
    Effect.asVoid
  )

const removeContainersFallback = (
  item: ProjectItem
): Effect.Effect<void, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(removeContainerByName(item.projectDir, item.containerName))
    yield* _(removeContainerByName(item.projectDir, `${item.containerName}-browser`))
  })

// CHANGE: delete a docker-git project directory (state) selected in the TUI
// WHY: allow removing unwanted projects without rewriting git history (just delete the folder)
// QUOTE(ТЗ): "Сделай возможность так же удалять мусорный для меня контейнер... Не нужно чистить гит историю. Пусть просто папку с ним удалит"
// REF: user-request-2026-02-09-delete-project
// SOURCE: n/a
// FORMAT THEOREM: forall p: delete(p) -> !exists(projectDir(p)) && !container_exists(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | DockerCommandError, FileSystem | Path | CommandExecutor>
// INVARIANT: never deletes paths outside the projects root
// COMPLEXITY: O(docker + fs)
export const deleteDockerGitProject = (
  item: ProjectItem
): Effect.Effect<
  void,
  PlatformError | DockerCommandError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)

    const root = path.resolve(defaultProjectsRoot(process.cwd()))
    const targetDir = path.resolve(item.projectDir)

    if (!isWithinProjectsRoot(path, root, targetDir)) {
      yield* _(Effect.logWarning(`Refusing to delete path outside projects root: ${targetDir}`))
      return
    }

    const exists = yield* _(fs.exists(targetDir))
    if (!exists) {
      yield* _(Effect.logWarning(`Project directory already missing: ${targetDir}`))
      return
    }

    // Best-effort: remove compose containers and volumes before deleting the project folder.
    yield* _(
      runDockerComposeDownVolumes(targetDir).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.gen(function*(_) {
              yield* _(Effect.logWarning(`docker compose down -v failed before delete: ${renderError(error)}`))
              yield* _(removeContainersFallback(item))
            }),
          onSuccess: () => Effect.void
        })
      )
    )

    yield* _(fs.remove(targetDir, { recursive: true, force: true }))

    const repoParts = deriveRepoPathParts(item.repoUrl).pathParts
    const label = repoParts.length > 0 ? repoParts.join("/") : item.repoUrl
    yield* _(autoSyncState(`chore(state): delete ${label}`))
  }).pipe(Effect.asVoid)
