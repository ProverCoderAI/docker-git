import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { runDockerComposeDown } from "../shell/docker.js"
import type { DockerCommandError } from "../shell/errors.js"
import { deriveRepoPathParts } from "../core/domain.js"
import { autoSyncState } from "./state-repo.js"
import { defaultProjectsRoot } from "./menu-helpers.js"
import type { ProjectItem } from "./projects-core.js"
import { renderError } from "./errors.js"

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

// CHANGE: delete a docker-git project directory (state) selected in the TUI
// WHY: allow removing unwanted projects without rewriting git history (just delete the folder)
// QUOTE(ТЗ): "Сделай возможность так же удалять мусорный для меня контейнер... Не нужно чистить гит историю. Пусть просто папку с ним удалит"
// REF: user-request-2026-02-09-delete-project
// SOURCE: n/a
// FORMAT THEOREM: forall p: delete(p) -> !exists(projectDir(p))
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | DockerCommandError, FileSystem | Path | CommandExecutor>
// INVARIANT: never deletes paths outside the projects root
// COMPLEXITY: O(docker + fs)
export const deleteDockerGitProject = (
  item: ProjectItem
): Effect.Effect<void, PlatformError | DockerCommandError, FileSystem.FileSystem | Path.Path | CommandExecutor> =>
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

    // Best-effort: stop the container if possible before removing the compose dir.
    yield* _(
      runDockerComposeDown(targetDir).pipe(
        Effect.catchTag("DockerCommandError", (error: DockerCommandError) =>
          Effect.logWarning(`docker compose down failed before delete: ${renderError(error)}`)
        )
      )
    )

    yield* _(fs.remove(targetDir, { recursive: true, force: true }))

    const repoParts = deriveRepoPathParts(item.repoUrl).pathParts
    const label = repoParts.length > 0 ? repoParts.join("/") : item.repoUrl
    yield* _(autoSyncState(`chore(state): delete ${label}`))
  }).pipe(Effect.asVoid)

