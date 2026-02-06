import { runDockerComposeDown } from "@effect-template/lib/shell/docker"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { connectProjectSshWithUp, type ProjectItem } from "@effect-template/lib/usecases/projects"

import { Effect, pipe } from "effect"

import { resetToMenu, resumeTui, suspendTui } from "./menu-shared.js"
import type { MenuEnv, MenuKeyInput, MenuRunner, MenuViewContext, ViewState } from "./menu-types.js"

// CHANGE: handle project selection flow in TUI
// WHY: allow selecting active project without manual typing
// QUOTE(ТЗ): "А ты можешь сделать удобный выбор проектов?"
// REF: user-request-2026-02-02-select-project
// SOURCE: n/a
// FORMAT THEOREM: forall p: select(p) -> activeDir(p)
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: selected index always within items length
// COMPLEXITY: O(1) per keypress

type SelectContext = MenuViewContext & {
  readonly runner: MenuRunner
  readonly setSshActive: (active: boolean) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
}

export const startSelectView = (
  items: ReadonlyArray<ProjectItem>,
  purpose: "Connect" | "Down",
  context: Pick<SelectContext, "setView" | "setMessage">
) => {
  context.setMessage(null)
  context.setView({ _tag: "SelectProject", purpose, items, selected: 0 })
}

const clampIndex = (value: number, size: number): number => {
  if (size <= 0) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value >= size) {
    return size - 1
  }
  return value
}

export const handleSelectInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: SelectContext
) => {
  if (key.escape) {
    resetToMenu(context)
    return
  }
  if (handleSelectNavigation(key, view, context)) {
    return
  }
  if (key.return) {
    handleSelectReturn(view, context)
    return
  }
  handleSelectHint(input, context)
}

const handleSelectNavigation = (
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: SelectContext
): boolean => {
  if (key.upArrow) {
    const next = clampIndex(view.selected - 1, view.items.length)
    context.setView({ ...view, selected: next })
    return true
  }
  if (key.downArrow) {
    const next = clampIndex(view.selected + 1, view.items.length)
    context.setView({ ...view, selected: next })
    return true
  }
  return false
}

const runWithSuspendedTui = (
  context: Pick<SelectContext, "runner" | "setMessage" | "setSkipInputs">,
  effect: Effect.Effect<void, AppError, MenuEnv>,
  onResume: () => void,
  doneMessage: string
) => {
  context.runner.runEffect(
    pipe(
      Effect.sync(suspendTui),
      Effect.zipRight(effect),
      Effect.ensuring(
        Effect.sync(() => {
          resumeTui()
          onResume()
          context.setSkipInputs(() => 2)
        })
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          context.setMessage(doneMessage)
        })
      )
    )
  )
}

const runConnectSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Connecting to ${selected.displayName}...`)
  context.setSshActive(true)
  runWithSuspendedTui(
    context,
    connectProjectSshWithUp(selected),
    () => {
      context.setSshActive(false)
    },
    "SSH session ended. Press Esc to return to the menu."
  )
}

const runDownSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Stopping ${selected.displayName}...`)
  runWithSuspendedTui(
    context,
    runDockerComposeDown(selected.projectDir),
    () => {},
    "Container stopped. Press Esc to return to the menu."
  )
}

const handleSelectReturn = (
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: SelectContext
) => {
  const selected = view.items[view.selected]
  if (!selected) {
    context.setMessage("No project selected.")
    resetToMenu(context)
    return
  }

  context.setActiveDir(selected.projectDir)

  if (view.purpose === "Connect") {
    runConnectSelection(selected, context)
    return
  }

  runDownSelection(selected, context)
}

const handleSelectHint = (input: string, context: SelectContext) => {
  if (input.trim().length > 0) {
    context.setMessage("Use arrows + Enter to select a project, Esc to cancel.")
  }
}

export const loadSelectView = <E>(
  effect: Effect.Effect<ReadonlyArray<ProjectItem>, E, MenuEnv>,
  purpose: "Connect" | "Down",
  context: Pick<SelectContext, "setView" | "setMessage">
): Effect.Effect<void, E, MenuEnv> =>
  pipe(
    effect,
    Effect.flatMap((items) =>
      Effect.sync(() => {
        if (items.length === 0) {
          context.setMessage("No docker-git projects found in .docker-git.")
          return
        }
        startSelectView(items, purpose, context)
      })
    )
  )
