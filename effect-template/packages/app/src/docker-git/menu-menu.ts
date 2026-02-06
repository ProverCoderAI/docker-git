import { type MenuAction, parseMenuSelection, type ProjectConfig } from "@effect-template/lib/core/domain"
import { readProjectConfig } from "@effect-template/lib/shell/config"
import { runDockerComposeDown, runDockerComposeLogs, runDockerComposePs } from "@effect-template/lib/shell/docker"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { renderError } from "@effect-template/lib/usecases/errors"
import {
  findSshPrivateKey,
  formatConnectionInfo,
  isRepoUrlInput,
  resolveAuthorizedKeysPath
} from "@effect-template/lib/usecases/menu-helpers"
import { buildSshCommand, listProjectItems, listProjectSummaries } from "@effect-template/lib/usecases/projects"
import { runDockerComposeUpWithPortCheck } from "@effect-template/lib/usecases/projects-up"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Either, Match, pipe } from "effect"

import { startCreateView } from "./menu-create.js"
import { loadSelectView } from "./menu-select.js"
import { resumeTui, suspendTui } from "./menu-shared.js"
import { type MenuEnv, menuItems, type MenuRunner, type MenuState, type ViewState } from "./menu-types.js"

// CHANGE: keep menu actions and input parsing in a dedicated module
// WHY: reduce cognitive complexity in the TUI entry
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall a: action(a) -> effect(a)
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: menu selection runs exactly one action
// COMPLEXITY: O(1) per keypress

const continueOutcome = (state: MenuState): { readonly _tag: "Continue"; readonly state: MenuState } => ({
  _tag: "Continue",
  state
})

const quitOutcome: { readonly _tag: "Quit" } = { _tag: "Quit" }

type MenuContext = {
  readonly state: MenuState
  readonly runner: MenuRunner
  readonly exit: () => void
  readonly setView: (view: ViewState) => void
  readonly setMessage: (message: string | null) => void
}

type MenuSelectionContext = MenuContext & {
  readonly selected: number
  readonly setSelected: (update: (value: number) => number) => void
}

const actionLabel = (action: MenuAction): string =>
  Match.value(action).pipe(
    Match.when({ _tag: "Up" }, () => "docker compose up"),
    Match.when({ _tag: "Status" }, () => "docker compose ps"),
    Match.when({ _tag: "Logs" }, () => "docker compose logs"),
    Match.when({ _tag: "Down" }, () => "docker compose down"),
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
    Match.exhaustive
  )

const showActiveConnectionInfo = (
  state: MenuState,
  setMessage: (message: string | null) => void
): Effect.Effect<void, AppError, MenuEnv> =>
  withProjectConfig(state, setMessage, (config) =>
    Effect.gen(function*(_) {
      const path = yield* _(Path.Path)
      const fs = yield* _(FileSystem.FileSystem)
      const baseDir = state.activeDir ?? state.cwd
      const resolvedAuthorizedKeys = resolveAuthorizedKeysPath(path, baseDir, config.template.authorizedKeysPath)
      const authExists = yield* _(fs.exists(resolvedAuthorizedKeys))
      const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
      const sshCommand = buildSshCommand(config.template, sshKey)
      const info = formatConnectionInfo(baseDir, config, resolvedAuthorizedKeys, authExists, sshCommand)

      yield* _(
        Effect.sync(() => {
          setMessage(info)
        })
      )

      if (!authExists) {
        yield* _(
          Effect.sync(() => {
            setMessage(`${info}\n\nCreate ${resolvedAuthorizedKeys} with your public key to enable SSH.`)
          })
        )
      }
    })).pipe(Effect.asVoid)
const showAllConnectionInfo = (
  setMessage: (message: string | null) => void
): Effect.Effect<void, AppError, MenuEnv> =>
  pipe(
    listProjectSummaries,
    Effect.flatMap((summaries) =>
      Effect.sync(() => {
        if (summaries.length === 0) {
          setMessage("No docker-git projects found in .docker-git.")
          return
        }
        setMessage(["Available projects:", ...summaries].join("\n\n"))
      })
    )
  )
const runCreateAction = (context: MenuContext) => {
  startCreateView(context.setView, context.setMessage)
}

const runSelectAction = (context: MenuContext) => {
  context.setMessage(null)
  context.runner.runEffect(loadSelectView(listProjectItems, context))
}

const runInfoAction = (context: MenuContext) => {
  context.setMessage(null)
  const effect = context.state.activeDir === null
    ? showAllConnectionInfo(context.setMessage)
    : showActiveConnectionInfo(context.state, context.setMessage)
  context.runner.runEffect(effect)
}

const runComposeAction = (action: MenuAction, context: MenuContext) => {
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

const handleMenuActionSelection = (action: MenuAction, context: MenuContext) => {
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
      runComposeAction(selected, context)
    }),
    Match.when({ _tag: "Quit" }, (selected) => {
      runQuitAction(context, selected)
    }),
    Match.exhaustive
  )
}

const handleMenuNavigation = (
  key: { readonly upArrow?: boolean; readonly downArrow?: boolean },
  setSelected: (update: (value: number) => number) => void
) => {
  if (key.upArrow) {
    setSelected((prev) => (prev === 0 ? menuItems.length - 1 : prev - 1))
    return
  }
  if (key.downArrow) {
    setSelected((prev) => (prev === menuItems.length - 1 ? 0 : prev + 1))
  }
}

const handleMenuEnter = (context: MenuSelectionContext) => {
  const action = menuItems[context.selected]?.id
  if (!action) {
    return
  }
  handleMenuActionSelection(action, context)
}

const handleMenuTextInput = (input: string, context: MenuContext): boolean => {
  const trimmed = input.trim()
  if (trimmed.length > 0 && isRepoUrlInput(trimmed)) {
    startCreateView(context.setView, context.setMessage, trimmed)
    return true
  }
  const selection = parseMenuSelection(input)
  if (Either.isRight(selection)) {
    handleMenuActionSelection(selection.right, context)
    return true
  }
  return false
}

export const handleMenuInput = (
  input: string,
  key: { readonly upArrow?: boolean; readonly downArrow?: boolean; readonly return?: boolean },
  context: MenuSelectionContext
) => {
  if (key.upArrow || key.downArrow) {
    handleMenuNavigation(key, context.setSelected)
    return
  }
  if (key.return) {
    handleMenuEnter(context)
    return
  }
  handleMenuTextInput(input, context)
}
