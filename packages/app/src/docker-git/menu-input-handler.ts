import { handleCreateInput } from "./menu-create.js"
import { handleMenuInput } from "./menu-menu.js"
import { handleSelectInput } from "./menu-select.js"
import type { MenuKeyInput, MenuRunner, MenuState, MenuViewContext, ViewState } from "./menu-types.js"

export type InputStage = "cold" | "active"

export type MenuInputContext = MenuViewContext & {
  readonly busy: boolean
  readonly view: ViewState
  readonly inputStage: InputStage
  readonly setInputStage: (stage: InputStage) => void
  readonly selected: number
  readonly setSelected: (update: (value: number) => number) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
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

export const handleUserInput = (
  input: string,
  key: MenuKeyInput,
  context: MenuInputContext
) => {
  if (context.busy || context.sshActive) {
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
    activeDir: context.state.activeDir,
    runner: context.runner,
    setSshActive: context.setSshActive,
    setSkipInputs: context.setSkipInputs
  })
}
