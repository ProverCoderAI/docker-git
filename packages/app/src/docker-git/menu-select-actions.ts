import { Effect, pipe } from "effect"

import { deleteMenuProject, downMenuProject, listMenuRunningProjectItems } from "./menu-api.js"
import { renderMenuError } from "./menu-errors.js"
import { openProjectAuthSelection } from "./menu-project-auth.js"
import { buildConnectEffect } from "./menu-select-connect.js"
import { loadRuntimeByProject } from "./menu-select-runtime.js"
import { startSelectView } from "./menu-select-view.js"
import { pauseOnError, resetToMenu, resumeWithSkipInputs, withSuspendedTui } from "./menu-shared.js"
import type { MenuRunner, MenuViewContext } from "./menu-types.js"
import { openResolvedProjectSshViaControllerWithUp } from "./open-project.js"
import type { ProjectItem } from "./project-item.js"

export type SelectContext = MenuViewContext & {
  readonly activeDir: string | null
  readonly runner: MenuRunner
  readonly setSshActive: (active: boolean) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
}

export const runConnectSelection = (
  selected: ProjectItem,
  context: SelectContext,
  enableMcpPlaywright: boolean
) => {
  if (enableMcpPlaywright) {
    context.setMessage(
      "Playwright MCP pre-connect toggle is not routed through the controller yet."
    )
    return
  }

  context.setMessage(`Connecting to ${selected.displayName}...`)
  context.setSshActive(true)
  context.runner.runInteractiveEffect(
    pipe(
      buildConnectEffect(selected, false, {
        connectWithUp: (item) => openResolvedProjectSshViaControllerWithUp(item),
        enableMcpPlaywright: () => Effect.void
      }),
      Effect.tap(() =>
        Effect.sync(() => {
          context.setMessage("SSH session ended. Press Esc to return to the menu.")
        })
      ),
      Effect.ensuring(
        Effect.sync(() => {
          context.setSshActive(false)
          context.setSkipInputs(() => 2)
        })
      ),
      Effect.asVoid
    )
  )
}

export const runDownSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Stopping ${selected.displayName}...`)
  context.runner.runEffect(
    withSuspendedTui(
      pipe(
        downMenuProject(selected),
        Effect.zipRight(listMenuRunningProjectItems),
        Effect.flatMap((items) =>
          pipe(
            loadRuntimeByProject(items),
            Effect.map((runtimeByProject) => ({ items, runtimeByProject }))
          )
        ),
        Effect.tap(({ items, runtimeByProject }) =>
          Effect.sync(() => {
            if (items.length === 0) {
              resetToMenu(context)
              context.setMessage("No running docker-git containers.")
              return
            }
            startSelectView(items, "Down", context, runtimeByProject)
            context.setMessage("Container stopped. Select another to stop, or Esc to return.")
          })
        ),
        Effect.asVoid
      ),
      {
        onError: pauseOnError(renderMenuError),
        onResume: resumeWithSkipInputs(context)
      }
    )
  )
}

export const runInfoSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Details for ${selected.displayName} are shown on the right. Press Esc to return to the menu.`)
}

export const runAuthSelection = (selected: ProjectItem, context: SelectContext) => {
  openProjectAuthSelection(selected, context)
}

export const runDeleteSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Deleting ${selected.displayName}...`)
  context.runner.runEffect(
    pipe(
      withSuspendedTui(
        deleteMenuProject(selected).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (context.activeDir === selected.projectDir) {
                context.setActiveDir(null)
              }
              context.setView({ _tag: "Menu" })
            })
          ),
          Effect.asVoid
        ),
        {
          onError: pauseOnError(renderMenuError),
          onResume: resumeWithSkipInputs(context)
        }
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          context.setMessage("Project deleted.")
        })
      ),
      Effect.asVoid
    )
  )
}
