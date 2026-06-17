import { Effect, pipe } from "effect"
import React, { useCallback } from "react"

import type { GridlandModule } from "@gridland/bun"

import { renderMenuProjectSummaries } from "./menu-api.js"
import { renderCreateStepLabel, resolveCreateFlowSteps, resolveCreateInputs } from "./menu-create-shared.js"
import type { MenuError } from "./menu-errors.js"
import { GridlandMenuProvider, runGridlandMenu, useGridlandMenuInput } from "./menu-gridland-runtime.js"
import {
  renderAuthMenu,
  renderAuthPrompt,
  renderCreate,
  renderMenu,
  renderProjectAuthMenu,
  renderProjectAuthPrompt,
  renderSelect
} from "./menu-render.js"
import { leaveTui } from "./menu-shared.js"
import {
  defaultMenuSnapshot,
  type InteractiveMenuEffect,
  type MenuSnapshotStore,
  type QueueInteractiveEffect,
  useMenuState,
  useReadyGate,
  useSigintGuard,
  useStartupSnapshot
} from "./menu-state.js"
import { type MenuEnv, type MenuState, type ViewState } from "./menu-types.js"

const gridlandBootstrapError = (message: string): MenuError => ({
  _tag: "TerminalSessionClientError",
  message
})

type RenderContext = {
  readonly state: MenuState
  readonly view: ViewState
  readonly activeDir: string | null
  readonly runningDockerGitContainers: number
  readonly selected: number
  readonly busy: boolean
  readonly message: string | null
}

const renderView = (context: RenderContext) => {
  if (context.view._tag === "Menu") {
    return renderMenu({
      cwd: context.state.cwd,
      activeDir: context.activeDir,
      runningDockerGitContainers: context.runningDockerGitContainers,
      selected: context.selected,
      busy: context.busy,
      message: context.message
    })
  }

  if (context.view._tag === "Create") {
    const currentDefaults = resolveCreateInputs(context.state.cwd, context.view.values)
    const steps = resolveCreateFlowSteps(context.view.values)
    const step = steps[context.view.step] ?? "repoUrl"
    const label = renderCreateStepLabel(step, currentDefaults)

    return renderCreate({
      buffer: context.view.buffer,
      defaults: currentDefaults,
      label,
      message: context.message,
      stepIndex: context.view.step,
      steps
    })
  }

  if (context.view._tag === "AuthMenu") {
    return renderAuthMenu(context.view.snapshot, context.view.selected, context.message)
  }

  if (context.view._tag === "AuthPrompt") {
    return renderAuthPrompt(context.view, context.message)
  }

  if (context.view._tag === "ProjectAuthMenu") {
    return renderProjectAuthMenu(context.view.snapshot, context.view.selected, context.message)
  }

  if (context.view._tag === "ProjectAuthPrompt") {
    return renderProjectAuthPrompt(context.view, context.message)
  }

  return renderSelect({
    purpose: context.view.purpose,
    items: context.view.items,
    selected: context.view.selected,
    query: context.view.query,
    runtimeByProject: context.view.runtimeByProject,
    confirmDelete: context.view.confirmDelete,
    connectEnableMcpPlaywright: context.view.connectEnableMcpPlaywright,
    message: context.message
  })
}

type GridlandTuiAppProps = {
  readonly exit: () => void
  readonly gridland: GridlandModule
  readonly store: MenuSnapshotStore
  readonly queueInteractiveEffect: QueueInteractiveEffect
}

const GridlandTuiApp = ({ exit, gridland, queueInteractiveEffect, store }: GridlandTuiAppProps) => {
  const requestInteractiveEffect = useCallback(
    (effect: InteractiveMenuEffect) => {
      queueInteractiveEffect(effect)
      exit()
    },
    [exit, queueInteractiveEffect]
  )
  const menu = useMenuState(store, requestInteractiveEffect)

  useReadyGate(menu.setReady)
  useStartupSnapshot(store, menu.setActiveDir, menu.setRunningDockerGitContainers, menu.setMessage)
  useSigintGuard(exit, menu.sshActive)
  useGridlandMenuInput(gridland, { ...menu, exit })

  return React.createElement(
    GridlandMenuProvider,
    {
      children: renderView({
        state: menu.state,
        view: menu.view,
        activeDir: menu.activeDir,
        runningDockerGitContainers: menu.runningDockerGitContainers,
        selected: menu.selected,
        busy: menu.busy,
        message: menu.message
      }),
      gridland
    }
  )
}

const runGridlandMenuOnce = (
  store: MenuSnapshotStore,
  queueInteractiveEffect: QueueInteractiveEffect
): Effect.Effect<void, MenuError, MenuEnv> =>
  pipe(
    runGridlandMenu((args) =>
      React.createElement(GridlandTuiApp, {
        ...args,
        store,
        queueInteractiveEffect
      })
    ),
    Effect.mapError((error) => gridlandBootstrapError(error.message)),
    Effect.ensuring(leaveTui()),
    Effect.asVoid
  )

const restoreMenuAfterInteractiveEffect = (store: MenuSnapshotStore): void => {
  store.current = {
    ...store.current,
    busy: false,
    ready: false,
    skipInputs: 2,
    sshActive: false
  }
}

// CHANGE: provide an interactive TUI menu for docker-git
// WHY: allow dynamic selection and inline create flow without raw prompts
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall s: tui(s) -> state transitions
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: app exits only on Quit or ctrl+c
// COMPLEXITY: O(1) per input
//
// CHANGE: guard against non-TTY environments (Docker without -t)
// WHY: interactive Gridland host still requires a real TTY; without one
//      fall back to the project summary renderer.
// QUOTE(ТЗ): "вечный цикл зависания на TUI из за ошибки Raw mode is not supported"
// REF: issue-100
// SOURCE: n/a
// FORMAT THEOREM: ∀ env: isTTY(env) → renderTui ∧ ¬isTTY(env) → listProjects(api)
// INVARIANT: Gridland host only starts when stdin.isTTY ∧ stdout.isTTY
const runInteractiveMenu = (): Effect.Effect<void, MenuError, MenuEnv> =>
  Effect.gen(function*(_) {
    const store: MenuSnapshotStore = { current: defaultMenuSnapshot() }
    const queuedInteractiveEffect: { current: InteractiveMenuEffect | null } = { current: null }
    let isKeepRunning = true

    while (isKeepRunning) {
      yield* _(
        runGridlandMenuOnce(store, (effect) => {
          queuedInteractiveEffect.current = effect
        })
      )

      const nextInteractiveEffect = queuedInteractiveEffect.current
      if (nextInteractiveEffect === null) {
        isKeepRunning = false
        continue
      }

      queuedInteractiveEffect.current = null
      yield* _(
        pipe(
          leaveTui(),
          Effect.zipRight(nextInteractiveEffect),
          Effect.ensuring(
            pipe(
              Effect.sync(() => {
                restoreMenuAfterInteractiveEffect(store)
              }),
              Effect.zipRight(leaveTui())
            )
          )
        )
      )
    }
  })

export const runMenu: Effect.Effect<void, MenuError, MenuEnv> = pipe(
  Effect.sync(() => process.stdin.isTTY && process.stdout.isTTY),
  Effect.flatMap((hasTty) => (hasTty ? runInteractiveMenu() : renderMenuProjectSummaries()))
)

export type MenuRuntimeError = MenuError
