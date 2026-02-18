import { runDockerComposeDown } from "@effect-template/lib/shell/docker"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { renderError } from "@effect-template/lib/usecases/errors"
import { mcpPlaywrightUp } from "@effect-template/lib/usecases/mcp-playwright"
import {
  connectProjectSshWithUp,
  deleteDockerGitProject,
  listRunningProjectItems,
  type ProjectItem
} from "@effect-template/lib/usecases/projects"
import { Effect, pipe } from "effect"

import { openProjectAuthMenu } from "./menu-project-auth.js"
import { buildConnectEffect } from "./menu-select-connect.js"
import { loadRuntimeByProject } from "./menu-select-runtime.js"
import { startSelectView } from "./menu-select-view.js"
import {
  pauseOnError,
  resetToMenu,
  resumeSshWithSkipInputs,
  resumeWithSkipInputs,
  withSuspendedTui
} from "./menu-shared.js"
import type { MenuRunner, MenuViewContext } from "./menu-types.js"

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
  context.setMessage(
    enableMcpPlaywright
      ? `Enabling Playwright MCP for ${selected.displayName}, then connecting...`
      : `Connecting to ${selected.displayName}...`
  )
  context.setSshActive(true)
  context.runner.runEffect(
    pipe(
      withSuspendedTui(
        buildConnectEffect(selected, enableMcpPlaywright, {
          connectWithUp: (item) =>
            connectProjectSshWithUp(item).pipe(
              Effect.mapError((error): AppError => error)
            ),
          enableMcpPlaywright: (projectDir) =>
            mcpPlaywrightUp({ _tag: "McpPlaywrightUp", projectDir, runUp: false }).pipe(
              Effect.asVoid,
              Effect.mapError((error): AppError => error)
            )
        }),
        {
          onError: pauseOnError(renderError),
          onResume: resumeSshWithSkipInputs(context)
        }
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          context.setMessage("SSH session ended. Press Esc to return to the menu.")
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
        runDockerComposeDown(selected.projectDir),
        Effect.zipRight(listRunningProjectItems),
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
        onError: pauseOnError(renderError),
        onResume: resumeWithSkipInputs(context)
      }
    )
  )
}

export const runInfoSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Details for ${selected.displayName} are shown on the right. Press Esc to return to the menu.`)
}

export const runAuthSelection = (selected: ProjectItem, context: SelectContext) => {
  openProjectAuthMenu({
    project: selected,
    runner: context.runner,
    setView: context.setView,
    setMessage: context.setMessage,
    setActiveDir: context.setActiveDir
  })
}

export const runDeleteSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Deleting ${selected.displayName}...`)
  context.runner.runEffect(
    pipe(
      withSuspendedTui(
        deleteDockerGitProject(selected).pipe(
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
          onError: pauseOnError(renderError),
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
