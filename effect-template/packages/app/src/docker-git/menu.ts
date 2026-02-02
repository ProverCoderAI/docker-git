import { type InputCancelledError, InputReadError } from "@effect-template/lib/shell/errors"
import { type AppError, renderError } from "@effect-template/lib/usecases/errors"
import { NodeContext } from "@effect/platform-node"
import { Effect, pipe } from "effect"
import { render, useApp, useInput } from "ink"
import React, { useEffect, useMemo, useState } from "react"

import { handleCreateInput, resolveCreateInputs } from "./menu-create.js"
import { handleMenuInput } from "./menu-menu.js"
import { renderCreate, renderMenu, renderSelect, renderStepLabel } from "./menu-render.js"
import { handleSelectInput } from "./menu-select.js"
import {
  createSteps,
  type MenuEnv,
  type MenuKeyInput,
  type MenuRunner,
  type MenuState,
  type MenuViewContext,
  type ViewState
} from "./menu-types.js"

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

type InputStage = "cold" | "active"

type MenuInputContext = MenuViewContext & {
  readonly busy: boolean
  readonly view: ViewState
  readonly inputStage: InputStage
  readonly setInputStage: (stage: InputStage) => void
  readonly selected: number
  readonly setSelected: (update: (value: number) => number) => void
  readonly sshActive: boolean
  readonly setSshActive: (active: boolean) => void
  readonly state: MenuState
  readonly runner: MenuRunner
  readonly exit: () => void
}

const activateInput = (
  input: string,
  key: Pick<MenuKeyInput, "upArrow" | "downArrow" | "return">,
  context: Pick<MenuInputContext, "inputStage" | "setInputStage">
): { readonly activated: boolean; readonly allowProcessing: boolean } => {
  if (context.inputStage === "active") {
    return { activated: false, allowProcessing: true }
  }

  if (input.trim().length > 0) {
    context.setInputStage("active")
    return { activated: true, allowProcessing: true }
  }

  if (key.upArrow || key.downArrow || key.return) {
    context.setInputStage("active")
    return { activated: true, allowProcessing: false }
  }

  if (input.length > 0) {
    context.setInputStage("active")
    return { activated: true, allowProcessing: true }
  }

  return { activated: false, allowProcessing: false }
}

const shouldHandleMenuInput = (
  input: string,
  key: Pick<MenuKeyInput, "upArrow" | "downArrow" | "return">,
  context: Pick<MenuInputContext, "inputStage" | "setInputStage">
): boolean => {
  const activation = activateInput(input, key, context)
  if (activation.activated && !activation.allowProcessing) {
    return false
  }
  return activation.allowProcessing
}

const handleUserInput = (
  input: string,
  key: MenuKeyInput,
  context: MenuInputContext
) => {
  if (context.busy) {
    return
  }
  if (context.sshActive) {
    return
  }
  if (context.view._tag === "Menu") {
    if (!shouldHandleMenuInput(input, key, context)) {
      return
    }
    handleMenuInput(input, key, {
      selected: context.selected,
      setSelected: context.setSelected,
      state: context.state,
      runner: context.runner,
      exit: context.exit,
      setView: context.setView,
      setMessage: context.setMessage
    })
    return
  }

  if (context.view._tag === "Create") {
    handleCreateInput(input, key, context.view, {
      state: context.state,
      setView: context.setView,
      setMessage: context.setMessage,
      runner: context.runner,
      setActiveDir: context.setActiveDir
    })
    return
  }

  handleSelectInput(input, key, context.view, {
    setView: context.setView,
    setMessage: context.setMessage,
    setActiveDir: context.setActiveDir,
    runner: context.runner,
    setSshActive: context.setSshActive
  })
}

type RenderContext = {
  readonly state: MenuState
  readonly view: ViewState
  readonly activeDir: string | null
  readonly selected: number
  readonly busy: boolean
  readonly message: string | null
}

const renderView = (context: RenderContext) => {
  if (context.view._tag === "Menu") {
    return renderMenu(context.state.cwd, context.activeDir, context.selected, context.busy, context.message)
  }

  if (context.view._tag === "Create") {
    const currentDefaults = resolveCreateInputs(context.state.cwd, context.view.values)
    const step = createSteps[context.view.step] ?? "repoUrl"
    const label = renderStepLabel(step, currentDefaults)

    return renderCreate(label, context.view.buffer, context.message, context.view.step, currentDefaults)
  }

  return renderSelect(context.view.items, context.view.selected, context.message)
}

const useMenuState = () => {
  const [activeDir, setActiveDir] = useState<string | null>(null)
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
  Effect.tryPromise({
    try: () => render(React.createElement(TuiApp)).waitUntilExit(),
    catch: (error) => new InputReadError({ message: error instanceof Error ? error.message : String(error) })
  }),
  Effect.asVoid
)

export type MenuError = AppError | InputCancelledError
