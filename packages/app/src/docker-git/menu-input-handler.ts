import { handleAuthInput } from "./menu-auth.js"
import { handleCreateInput } from "./menu-create.js"
import { handleMenuInput } from "./menu-menu.js"
import { handleProjectAuthInput } from "./menu-project-auth.js"
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

type ActiveView = Exclude<ViewState, { readonly _tag: "Menu" }>

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

const handleMenuViewInput = (
  input: string,
  key: MenuKeyInput,
  context: MenuInputContext
) => {
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
    setMessage: context.setMessage,
    setActiveDir: context.setActiveDir
  })
}

const handleCreateViewInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "Create" }>,
  context: MenuInputContext
) => {
  handleCreateInput(input, key, view, {
    state: context.state,
    setView: context.setView,
    setMessage: context.setMessage,
    runner: context.runner,
    setActiveDir: context.setActiveDir
  })
}

const handleAuthViewInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "AuthMenu" | "AuthPrompt" }>,
  context: MenuInputContext
) => {
  handleAuthInput(input, key, view, {
    state: context.state,
    setView: context.setView,
    setMessage: context.setMessage,
    setActiveDir: context.setActiveDir,
    runner: context.runner,
    setSshActive: context.setSshActive,
    setSkipInputs: context.setSkipInputs
  })
}

const handleProjectAuthViewInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "ProjectAuthMenu" | "ProjectAuthPrompt" }>,
  context: MenuInputContext
) => {
  handleProjectAuthInput(input, key, view, {
    runner: context.runner,
    setView: context.setView,
    setMessage: context.setMessage,
    setActiveDir: context.setActiveDir
  })
}

const handleSelectViewInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: MenuInputContext
) => {
  handleSelectInput(input, key, view, {
    setView: context.setView,
    setMessage: context.setMessage,
    setActiveDir: context.setActiveDir,
    activeDir: context.state.activeDir,
    runner: context.runner,
    setSshActive: context.setSshActive,
    setSkipInputs: context.setSkipInputs
  })
}

const handleActiveViewInput = (
  input: string,
  key: MenuKeyInput,
  view: ActiveView,
  context: MenuInputContext
) => {
  if (view._tag === "Create") {
    handleCreateViewInput(input, key, view, context)
    return
  }
  if (view._tag === "AuthMenu" || view._tag === "AuthPrompt") {
    handleAuthViewInput(input, key, view, context)
    return
  }
  if (view._tag === "ProjectAuthMenu" || view._tag === "ProjectAuthPrompt") {
    handleProjectAuthViewInput(input, key, view, context)
    return
  }
  handleSelectViewInput(input, key, view, context)
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
    handleMenuViewInput(input, key, context)
    return
  }
  handleActiveViewInput(input, key, context.view, context)
}
