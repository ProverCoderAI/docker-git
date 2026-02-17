import { type MenuAction, type ProjectConfig } from "@effect-template/lib/core/domain"
import { readProjectConfig } from "@effect-template/lib/shell/config"
import { runDockerComposeDown, runDockerComposeLogs, runDockerComposePs } from "@effect-template/lib/shell/docker"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { renderError } from "@effect-template/lib/usecases/errors"
import {
  downAllDockerGitProjects,
  listProjectItems,
  listProjectStatus,
  listRunningProjectItems
} from "@effect-template/lib/usecases/projects"
import { runDockerComposeUpWithPortCheck } from "@effect-template/lib/usecases/projects-up"
import { Effect, Match, pipe } from "effect"

import { startCreateView } from "./menu-create.js"
import { loadSelectView } from "./menu-select-load.js"
import { resumeTui, suspendTui } from "./menu-shared.js"
import { type MenuEnv, type MenuRunner, type MenuState, type ViewState } from "./menu-types.js"

// CHANGE: keep menu actions and input parsing in a dedicated module
// WHY: reduce cognitive complexity in the TUI entry
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall a: action(a) -> effect(a)
// PURITY: SHELL
// EFFECT: Effect<void, AppError, MenuEnv>
// INVARIANT: menu selection runs exactly one action
// COMPLEXITY: O(1) per keypress

const continueOutcome = (state: MenuState): { readonly _tag: "Continue"; readonly state: MenuState } => ({
  _tag: "Continue",
  state
})

const quitOutcome: { readonly _tag: "Quit" } = { _tag: "Quit" }

export type MenuContext = {
  readonly state: MenuState
  readonly runner: MenuRunner
  readonly exit: () => void
  readonly setView: (view: ViewState) => void
  readonly setMessage: (message: string | null) => void
}

export type MenuSelectionContext = MenuContext & {
  readonly selected: number
  readonly setSelected: (update: (value: number) => number) => void
}

const actionLabel = (action: MenuAction): string =>
  Match.value(action).pipe(
    Match.when({ _tag: "Up" }, () => "docker compose up"),
    Match.when({ _tag: "Status" }, () => "docker compose ps"),
    Match.when({ _tag: "Logs" }, () => "docker compose logs"),
    Match.when({ _tag: "Down" }, () => "docker compose down"),
    Match.when({ _tag: "DownAll" }, () => "docker compose down (all projects)"),
    Match.orElse(() => "action")
  )

const runWithSuspendedTui = (
  effect: Effect.Effect<void, AppError, MenuEnv>,
  context: MenuContext,
  label: string
) => {
  context.runner.runEffect(
    pipe(
      Effect.sync(() => {
        context.setMessage(`${label}...`)
        suspendTui()
      }),
      Effect.zipRight(effect),
      Effect.tap(() =>
        Effect.sync(() => {
          context.setMessage(`${label} finished.`)
        })
      ),
      Effect.ensuring(
        Effect.sync(() => {
          resumeTui()
        })
      ),
      Effect.asVoid
    )
  )
}

const requireActiveProject = (context: MenuContext): boolean => {
  if (context.state.activeDir) {
    return true
  }
  context.setMessage(
    "No active project. Use Create or paste a repo URL to set one before running this action."
  )
  return false
}

const handleMissingConfig = (
  state: MenuState,
  setMessage: (message: string | null) => void,
  error: AppError
) =>
  pipe(
    Effect.sync(() => {
      setMessage(renderError(error))
    }),
    Effect.as(continueOutcome(state))
  )

const withProjectConfig = <R>(
  state: MenuState,
  setMessage: (message: string | null) => void,
  f: (config: ProjectConfig) => Effect.Effect<void, AppError, R>
) =>
  pipe(
    readProjectConfig(state.activeDir ?? state.cwd),
    Effect.matchEffect({
      onFailure: (error) =>
        error._tag === "ConfigNotFoundError" || error._tag === "ConfigDecodeError"
          ? handleMissingConfig(state, setMessage, error)
          : Effect.fail(error),
      onSuccess: (config) =>
        pipe(
          f(config),
          Effect.as(continueOutcome(state))
        )
    })
  )

const handleMenuAction = (
  state: MenuState,
  setMessage: (message: string | null) => void,
  action: MenuAction
): Effect.Effect<
  { readonly _tag: "Continue"; readonly state: MenuState } | { readonly _tag: "Quit" },
  AppError,
  MenuEnv
> =>
  Match.value(action).pipe(
    Match.when({ _tag: "Quit" }, () => Effect.succeed(quitOutcome)),
    Match.when({ _tag: "Create" }, () => Effect.succeed(continueOutcome(state))),
    Match.when({ _tag: "Select" }, () => Effect.succeed(continueOutcome(state))),
    Match.when({ _tag: "Info" }, () => Effect.succeed(continueOutcome(state))),
    Match.when({ _tag: "Delete" }, () => Effect.succeed(continueOutcome(state))),
    Match.when({ _tag: "Up" }, () =>
      withProjectConfig(state, setMessage, () =>
        runDockerComposeUpWithPortCheck(state.activeDir ?? state.cwd).pipe(Effect.asVoid))),
    Match.when({ _tag: "Status" }, () =>
      withProjectConfig(state, setMessage, () =>
        runDockerComposePs(state.activeDir ?? state.cwd))),
    Match.when({ _tag: "Logs" }, () =>
      withProjectConfig(state, setMessage, () =>
        runDockerComposeLogs(state.activeDir ?? state.cwd))),
    Match.when({ _tag: "Down" }, () =>
      withProjectConfig(state, setMessage, () =>
        runDockerComposeDown(state.activeDir ?? state.cwd))),
    Match.when({ _tag: "DownAll" }, () =>
      pipe(
        downAllDockerGitProjects,
        Effect.as(continueOutcome(state))
      )),
    Match.exhaustive
  )

const runCreateAction = (context: MenuContext) => {
  startCreateView(context.setView, context.setMessage)
}

const runSelectAction = (context: MenuContext) => {
  context.setMessage(null)
  context.runner.runEffect(loadSelectView(listProjectItems, "Connect", context))
}

const runDownAllAction = (context: MenuContext) => {
  context.setMessage(null)
  runWithSuspendedTui(downAllDockerGitProjects, context, "Stopping all docker-git containers")
}

const runDownAction = (context: MenuContext, action: MenuAction) => {
  context.setMessage(null)
  if (context.state.activeDir === null) {
    context.runner.runEffect(loadSelectView(listRunningProjectItems, "Down", context))
    return
  }
  runComposeAction(action, context)
}

const runInfoAction = (context: MenuContext) => {
  context.setMessage(null)
  context.runner.runEffect(loadSelectView(listProjectItems, "Info", context))
}

const runDeleteAction = (context: MenuContext) => {
  context.setMessage(null)
  context.runner.runEffect(loadSelectView(listProjectItems, "Delete", context))
}

const runComposeAction = (action: MenuAction, context: MenuContext) => {
  if (action._tag === "Status" && context.state.activeDir === null) {
    runWithSuspendedTui(listProjectStatus, context, "docker compose ps (all projects)")
    return
  }
  if (!requireActiveProject(context)) {
    return
  }
  const effect = pipe(handleMenuAction(context.state, context.setMessage, action), Effect.asVoid)
  runWithSuspendedTui(effect, context, actionLabel(action))
}

const runQuitAction = (context: MenuContext, action: MenuAction) => {
  context.runner.runEffect(
    pipe(handleMenuAction(context.state, context.setMessage, action), Effect.asVoid)
  )
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
    Match.when({ _tag: "Quit" }, (selected) => {
      runQuitAction(context, selected)
    }),
    Match.exhaustive
  )
}
