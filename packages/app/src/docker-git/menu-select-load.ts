import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect, pipe } from "effect"

import { loadRuntimeByProject } from "./menu-select-runtime.js"
import { startSelectView } from "./menu-select.js"
import type { MenuEnv, MenuViewContext } from "./menu-types.js"

export const loadSelectView = <E>(
  effect: Effect.Effect<ReadonlyArray<ProjectItem>, E, MenuEnv>,
  purpose: "Connect" | "Down" | "Info" | "Delete" | "Auth",
  context: Pick<MenuViewContext, "setView" | "setMessage">
): Effect.Effect<void, E, MenuEnv> =>
  pipe(
    effect,
    Effect.flatMap((items) =>
      pipe(
        loadRuntimeByProject(items),
        Effect.flatMap((runtimeByProject) =>
          Effect.sync(() => {
            if (items.length === 0) {
              context.setMessage(
                purpose === "Down"
                  ? "No running docker-git containers."
                  : "No docker-git projects found."
              )
              return
            }
            startSelectView(items, purpose, context, runtimeByProject)
          })
        )
      )
    )
  )
