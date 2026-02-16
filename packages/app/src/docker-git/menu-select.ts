import { runDockerComposeDown } from "@effect-template/lib/shell/docker"
import type { AppError } from "@effect-template/lib/usecases/errors"
import {
  connectProjectSshWithUp,
  deleteDockerGitProject,
  listRunningProjectItems,
  type ProjectItem
} from "@effect-template/lib/usecases/projects"

import { Effect, Match, pipe } from "effect"

import { loadRuntimeByProject, runtimeForSelection } from "./menu-select-runtime.js"
import { resetToMenu, resumeTui, suspendTui } from "./menu-shared.js"
import type {
  MenuEnv,
  MenuKeyInput,
  MenuRunner,
  MenuViewContext,
  SelectProjectRuntime,
  ViewState
} from "./menu-types.js"

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
  readonly activeDir: string | null
  readonly runner: MenuRunner
  readonly setSshActive: (active: boolean) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
}

const emptyRuntimeByProject = (): Readonly<Record<string, SelectProjectRuntime>> => ({})

export const startSelectView = (
  items: ReadonlyArray<ProjectItem>,
  purpose: "Connect" | "Down" | "Info" | "Delete",
  context: Pick<SelectContext, "setView" | "setMessage">,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>> = emptyRuntimeByProject()
) => {
  context.setMessage(null)
  context.setView({ _tag: "SelectProject", purpose, items, runtimeByProject, selected: 0, confirmDelete: false })
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
    context.setView({ ...view, selected: next, confirmDelete: false })
    return true
  }
  if (key.downArrow) {
    const next = clampIndex(view.selected + 1, view.items.length)
    context.setView({ ...view, selected: next, confirmDelete: false })
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
  context.runner.runEffect(
    pipe(
      Effect.sync(suspendTui),
      Effect.zipRight(runDockerComposeDown(selected.projectDir)),
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
      Effect.ensuring(
        Effect.sync(() => {
          resumeTui()
          context.setSkipInputs(() => 2)
        })
      ),
      Effect.asVoid
    )
  )
}

const runInfoSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Details for ${selected.displayName} are shown on the right. Press Esc to return to the menu.`)
}

const runDeleteSelection = (selected: ProjectItem, context: SelectContext) => {
  context.setMessage(`Deleting ${selected.displayName}...`)
  runWithSuspendedTui(
    context,
    deleteDockerGitProject(selected).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (context.activeDir === selected.projectDir) {
            context.setActiveDir(null)
          }
          context.setView({ _tag: "Menu" })
        })
      )
    ),
    () => {
      // Only return to menu on success (see Effect.tap above).
    },
    "Project deleted."
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
  const selectedRuntime = runtimeForSelection(view, selected)
  const sshSessionsLabel = selectedRuntime.sshSessions === 1
    ? "1 active SSH session"
    : `${selectedRuntime.sshSessions} active SSH sessions`

  Match.value(view.purpose).pipe(
    Match.when("Connect", () => {
      context.setActiveDir(selected.projectDir)
      runConnectSelection(selected, context)
    }),
    Match.when("Down", () => {
      if (selectedRuntime.sshSessions > 0 && !view.confirmDelete) {
        context.setMessage(
          `${selected.containerName} has ${sshSessionsLabel}. Press Enter again to stop, Esc to cancel.`
        )
        context.setView({ ...view, confirmDelete: true })
        return
      }
      context.setActiveDir(selected.projectDir)
      runDownSelection(selected, context)
    }),
    Match.when("Info", () => {
      context.setActiveDir(selected.projectDir)
      runInfoSelection(selected, context)
    }),
    Match.when("Delete", () => {
      if (!view.confirmDelete) {
        const activeSshWarning = selectedRuntime.sshSessions > 0 ? ` ${sshSessionsLabel}.` : ""
        context.setMessage(
          `Really delete ${selected.displayName}?${activeSshWarning} Press Enter again to confirm, Esc to cancel.`
        )
        context.setView({ ...view, confirmDelete: true })
        return
      }
      runDeleteSelection(selected, context)
    }),
    Match.exhaustive
  )
}

const handleSelectHint = (input: string, context: SelectContext) => {
  if (input.trim().length > 0) {
    context.setMessage("Use arrows + Enter to select a project, Esc to cancel.")
  }
}

export const loadSelectView = <E>(
  effect: Effect.Effect<ReadonlyArray<ProjectItem>, E, MenuEnv>,
  purpose: "Connect" | "Down" | "Info" | "Delete",
  context: Pick<SelectContext, "setView" | "setMessage">
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
