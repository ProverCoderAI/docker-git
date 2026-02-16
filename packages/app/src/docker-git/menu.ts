import { runDockerPsNames } from "@effect-template/lib/shell/docker"
import { type InputCancelledError, InputReadError } from "@effect-template/lib/shell/errors"
import { type AppError, renderError } from "@effect-template/lib/usecases/errors"
import { listProjectItems } from "@effect-template/lib/usecases/projects"
import { NodeContext } from "@effect/platform-node"
import { Effect, pipe } from "effect"
import { render, useApp, useInput } from "ink"
import React, { useEffect, useMemo, useState } from "react"

import { resolveCreateInputs } from "./menu-create.js"
import { handleUserInput, type InputStage } from "./menu-input-handler.js"
import { renderCreate, renderMenu, renderSelect, renderStepLabel } from "./menu-render.js"
import { leaveTui, resumeTui } from "./menu-shared.js"
import { defaultMenuStartupSnapshot, resolveMenuStartupSnapshot } from "./menu-startup.js"
import { createSteps, type MenuEnv, type MenuState, type ViewState } from "./menu-types.js"

// CHANGE: keep menu state in the TUI layer
// WHY: provide a dynamic interface with live selection and inputs
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall s: input(s) -> state'(s)
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: activeDir updated only after successful create
// COMPLEXITY: O(1) per keypress

const useRunner = (
  setBusy: (busy: boolean) => void,
  setMessage: (message: string | null) => void
) => {
  const runEffect = function<E extends AppError>(effect: Effect.Effect<void, E, MenuEnv>) {
    setBusy(true)
    const program = pipe(
      effect,
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.sync(() => {
            setMessage(renderError(error))
          }),
        onSuccess: () => Effect.void
      }),
      Effect.ensuring(
        Effect.sync(() => {
          setBusy(false)
        })
      )
    )
    void Effect.runPromise(Effect.provide(program, NodeContext.layer))
  }

  return { runEffect }
}

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
    const step = createSteps[context.view.step] ?? "repoUrl"
    const label = renderStepLabel(step, currentDefaults)

    return renderCreate(label, context.view.buffer, context.message, context.view.step, currentDefaults)
  }

  return renderSelect({
    purpose: context.view.purpose,
    items: context.view.items,
    selected: context.view.selected,
    runtimeByProject: context.view.runtimeByProject,
    confirmDelete: context.view.confirmDelete,
    connectEnableMcpPlaywright: context.view.connectEnableMcpPlaywright,
    message: context.message
  })
}

const useMenuState = () => {
  const [activeDir, setActiveDir] = useState<string | null>(null)
  const [runningDockerGitContainers, setRunningDockerGitContainers] = useState(0)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [view, setView] = useState<ViewState>({ _tag: "Menu" })
  const [inputStage, setInputStage] = useState<InputStage>("cold")
  const [ready, setReady] = useState(false)
  const [skipInputs, setSkipInputs] = useState(2)
  const [sshActive, setSshActive] = useState(false)
  const ignoreUntil = useMemo(() => Date.now() + 400, [])
  const state = useMemo<MenuState>(() => ({ cwd: process.cwd(), activeDir }), [activeDir])
  const runner = useRunner(setBusy, setMessage)

  return {
    activeDir,
    setActiveDir,
    runningDockerGitContainers,
    setRunningDockerGitContainers,
    selected,
    setSelected,
    busy,
    message,
    setMessage,
    view,
    setView,
    inputStage,
    setInputStage,
    ready,
    setReady,
    skipInputs,
    setSkipInputs,
    sshActive,
    setSshActive,
    ignoreUntil,
    state,
    runner
  }
}

const useReadyGate = (setReady: (ready: boolean) => void) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true)
    }, 150)
    return () => {
      clearTimeout(timer)
    }
  }, [setReady])
}

const useStartupSnapshot = (
  setActiveDir: (value: string | null) => void,
  setRunningDockerGitContainers: (value: number) => void,
  setMessage: (message: string | null) => void
) => {
  useEffect(() => {
    let cancelled = false

    const startup = pipe(
      Effect.all([listProjectItems, runDockerPsNames(process.cwd())]),
      Effect.map(([items, runningNames]) => resolveMenuStartupSnapshot(items, runningNames)),
      Effect.catchAll(() => Effect.succeed(defaultMenuStartupSnapshot())),
      Effect.provide(NodeContext.layer)
    )

    void Effect.runPromise(startup).then((snapshot) => {
      if (cancelled) {
        return
      }
      setRunningDockerGitContainers(snapshot.runningDockerGitContainers)
      setMessage(snapshot.message)
      if (snapshot.activeDir !== null) {
        setActiveDir(snapshot.activeDir)
      }
    })

    return () => {
      cancelled = true
    }
  }, [setActiveDir, setMessage, setRunningDockerGitContainers])
}

const useSigintGuard = (exit: () => void, sshActive: boolean) => {
  useEffect(() => {
    const handleSigint = () => {
      if (sshActive) {
        return
      }
      exit()
    }
    process.on("SIGINT", handleSigint)
    return () => {
      process.off("SIGINT", handleSigint)
    }
  }, [exit, sshActive])
}

const TuiApp = () => {
  const { exit } = useApp()
  const menu = useMenuState()

  useReadyGate(menu.setReady)
  useStartupSnapshot(menu.setActiveDir, menu.setRunningDockerGitContainers, menu.setMessage)
  useSigintGuard(exit, menu.sshActive)

  useInput(
    (input, key) => {
      if (!menu.ready) {
        return
      }
      if (Date.now() < menu.ignoreUntil) {
        return
      }
      if (menu.skipInputs > 0) {
        menu.setSkipInputs((value) => (value > 0 ? value - 1 : 0))
        return
      }
      handleUserInput(input, key, {
        busy: menu.busy,
        view: menu.view,
        inputStage: menu.inputStage,
        setInputStage: menu.setInputStage,
        selected: menu.selected,
        setSelected: menu.setSelected,
        setSkipInputs: menu.setSkipInputs,
        sshActive: menu.sshActive,
        setSshActive: menu.setSshActive,
        state: menu.state,
        runner: menu.runner,
        exit,
        setView: menu.setView,
        setMessage: menu.setMessage,
        setActiveDir: menu.setActiveDir
      })
    },
    { isActive: !menu.sshActive }
  )

  return renderView({
    state: menu.state,
    view: menu.view,
    activeDir: menu.activeDir,
    runningDockerGitContainers: menu.runningDockerGitContainers,
    selected: menu.selected,
    busy: menu.busy,
    message: menu.message
  })
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
export const runMenu = pipe(
  Effect.sync(() => {
    resumeTui()
  }),
  Effect.zipRight(
    Effect.tryPromise({
      try: () => render(React.createElement(TuiApp)).waitUntilExit(),
      catch: (error) => new InputReadError({ message: error instanceof Error ? error.message : String(error) })
    })
  ),
  Effect.ensuring(
    Effect.sync(() => {
      leaveTui()
    })
  ),
  Effect.asVoid
)

export type MenuError = AppError | InputCancelledError
