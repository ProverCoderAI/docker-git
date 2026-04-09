import type { MenuAction } from "@lib/core/domain"
import { Effect, Match, pipe } from "effect"

import { downAllProjects, downProject, upProject } from "./api-client.js"
import {
  listMenuProjectItems,
  listMenuRunningProjectItems,
  renderMenuProjectLogs,
  renderMenuProjectPs,
  renderMenuProjectSummaries
} from "./menu-api.js"
import { openAuthMenu } from "./menu-auth.js"
import { startCreateView } from "./menu-create.js"
import type { MenuError } from "./menu-errors.js"
import { renderMenuError } from "./menu-errors.js"
import { openProjectAuthSelection } from "./menu-project-auth.js"
import { loadSelectView } from "./menu-select-load.js"
import { withSuspendedTui, writeErrorAndPause } from "./menu-shared.js"
import { type MenuEnv, type MenuRunner, type MenuState, type MenuViewContext } from "./menu-types.js"

// CHANGE: keep menu actions and input parsing in a dedicated module
// WHY: reduce cognitive complexity in the TUI entry
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall a: action(a) -> effect(a)
// PURITY: SHELL
// EFFECT: Effect<void, MenuError, MenuEnv>
// INVARIANT: menu selection runs exactly one action
// COMPLEXITY: O(1) per keypress

export type MenuContext = {
  readonly state: MenuState
  readonly runner: MenuRunner
  readonly exit: () => void
} & MenuViewContext

export type MenuSelectionContext = MenuContext & {
  readonly selected: number
  readonly setSelected: (update: (value: number) => number) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
}

const actionLabel = (action: MenuAction): string =>
  Match.value(action).pipe(
    Match.when({ _tag: "Auth" }, () => "Auth profiles"),
    Match.when({ _tag: "ProjectAuth" }, () => "Project auth"),
    Match.when({ _tag: "Up" }, () => "docker compose up"),
    Match.when({ _tag: "Status" }, () => "docker compose ps"),
    Match.when({ _tag: "Logs" }, () => "docker compose logs"),
    Match.when({ _tag: "Down" }, () => "docker compose down"),
    Match.when({ _tag: "DownAll" }, () => "docker compose down (all projects)"),
    Match.orElse(() => "action")
  )

const runWithSuspendedTui = (
  effect: Effect.Effect<void, MenuError, MenuEnv>,
  context: MenuContext,
  label: string
) => {
  context.runner.runEffect(
    pipe(
      Effect.sync(() => {
        context.setMessage(`${label}...`)
      }),
      Effect.zipRight(
        withSuspendedTui(effect, {
          onError: (error) => writeErrorAndPause(renderMenuError(error))
        })
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          context.setMessage(`${label} finished.`)
        })
      ),
      Effect.asVoid
    )
  )
}

const requireActiveProjectId = (context: MenuContext): string | null => {
  if (context.state.activeDir !== null) {
    return context.state.activeDir
  }

  context.setMessage(
    "No active project. Use Create or Select project before running this action."
  )
  return null
}

const runCreateAction = (context: MenuContext) => {
  startCreateView(context.setView, context.setMessage)
}

const runSelectAction = (context: MenuContext) => {
  context.setMessage(null)
  context.runner.runEffect(loadSelectView(listMenuProjectItems, "Connect", context))
}

const runAuthProfilesAction = (context: MenuContext) => {
  openAuthMenu({
    state: context.state,
    runner: context.runner,
    setView: context.setView,
    setMessage: context.setMessage,
    setActiveDir: context.setActiveDir
  })
}

const runProjectAuthAction = (context: MenuContext) => {
  if (context.state.activeDir !== null) {
    context.runner.runEffect(
      pipe(
        listMenuProjectItems,
        Effect.flatMap((items) => {
          const selected = items.find((item) => item.projectDir === context.state.activeDir)
          if (selected === undefined) {
            return Effect.sync(() => {
              context.setActiveDir(null)
              context.setMessage("Active project is no longer available. Select a project again.")
              context.runner.runEffect(loadSelectView(listMenuProjectItems, "Auth", context))
            })
          }
          return Effect.sync(() => {
            openProjectAuthSelection(selected, context)
          })
        })
      )
    )
    return
  }

  context.setMessage(null)
  context.runner.runEffect(loadSelectView(listMenuProjectItems, "Auth", context))
}

const runDownAllAction = (context: MenuContext) => {
  context.setMessage(null)
  runWithSuspendedTui(downAllProjects(), context, "Stopping all docker-git containers")
}

const runDownAction = (context: MenuContext, action: MenuAction) => {
  context.setMessage(null)
  if (context.state.activeDir === null) {
    context.runner.runEffect(loadSelectView(listMenuRunningProjectItems, "Down", context))
    return
  }

  runComposeAction(action, context)
}

const runInfoAction = (context: MenuContext) => {
  context.setMessage(null)
  context.runner.runEffect(loadSelectView(listMenuProjectItems, "Info", context))
}

const runDeleteAction = (context: MenuContext) => {
  context.setMessage(null)
  context.runner.runEffect(loadSelectView(listMenuProjectItems, "Delete", context))
}

const runComposeAction = (action: MenuAction, context: MenuContext) => {
  if (action._tag === "Status" && context.state.activeDir === null) {
    runWithSuspendedTui(renderMenuProjectSummaries(), context, "Loading project status")
    return
  }

  const projectId = requireActiveProjectId(context)
  if (projectId === null) {
    return
  }

  const effect = Match.value(action).pipe(
    Match.when({ _tag: "Up" }, () => upProject(projectId)),
    Match.when({ _tag: "Status" }, () => renderMenuProjectPs(projectId)),
    Match.when({ _tag: "Logs" }, () => renderMenuProjectLogs(projectId)),
    Match.when({ _tag: "Down" }, () => downProject(projectId)),
    Match.orElse(() => Effect.void)
  )

  runWithSuspendedTui(effect, context, actionLabel(action))
}

const runQuitAction = (context: MenuContext) => {
  context.setMessage(null)
  context.exit()
}

export const handleMenuActionSelection = (action: MenuAction, context: MenuContext) => {
  Match.value(action).pipe(
    Match.when({ _tag: "Create" }, () => {
      runCreateAction(context)
    }),
    Match.when({ _tag: "Select" }, () => {
      runSelectAction(context)
    }),
    Match.when({ _tag: "Auth" }, () => {
      runAuthProfilesAction(context)
    }),
    Match.when({ _tag: "ProjectAuth" }, () => {
      runProjectAuthAction(context)
    }),
    Match.when({ _tag: "Info" }, () => {
      runInfoAction(context)
    }),
    Match.when({ _tag: "Delete" }, () => {
      runDeleteAction(context)
    }),
    Match.when({ _tag: "Up" }, (selected) => {
      runComposeAction(selected, context)
    }),
    Match.when({ _tag: "Status" }, (selected) => {
      runComposeAction(selected, context)
    }),
    Match.when({ _tag: "Logs" }, (selected) => {
      runComposeAction(selected, context)
    }),
    Match.when({ _tag: "Down" }, (selected) => {
      runDownAction(context, selected)
    }),
    Match.when({ _tag: "DownAll" }, () => {
      runDownAllAction(context)
    }),
    Match.when({ _tag: "Quit" }, () => {
      runQuitAction(context)
    }),
    Match.exhaustive
  )
}
