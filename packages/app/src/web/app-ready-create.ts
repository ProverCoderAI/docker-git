import { type Dispatch, type SetStateAction, useEffect } from "react"

import { formatParseError } from "../docker-git/cli/usage.js"
import { nextBufferValue } from "../docker-git/menu-buffer-input.js"
import {
  advanceCreateDisplaySettingsStep,
  advanceCreateFlow,
  completeCreateDisplaySettingsFlow,
  createDisplayFlowView,
  type CreateFlowView,
  createInitialFlowView,
  type DisplayModeFlowView,
  handleAdvanceCreateFlowResult,
  isCreateFlowRepoStep,
  isDisplayModeFlowView,
  moveCreateDisplaySettingsStep,
  resolveCreateSettingsChoiceBuffer
} from "../docker-git/menu-create-shared.js"
import { submitCreateInputs } from "./actions-projects.js"
import { isGithubAuthConfigured } from "./actions-shared.js"
import type { BrowserActionContext } from "./actions.js"
import type { BrowserMenuTag } from "./menu.js"
import { menuScreen } from "./screen.js"

type Setter<A> = Dispatch<SetStateAction<A>>

const emptyRepoUrlInputError = "Insert URL first"

export type CreateSubmitMode = "advance" | "quick-create" | "complete-settings"

type CreateKeyArgs = {
  readonly context: BrowserActionContext
  readonly controllerCwd: string
  readonly projectsRoot: string
  readonly creationView: CreateFlowView
  readonly setCreationView: Setter<CreateFlowView>
}

type CreateSubmitArgs = CreateKeyArgs & {
  readonly mode: CreateSubmitMode
}

type CreateKeyboardEvent = {
  readonly key: string
  readonly shiftKey: boolean
  readonly preventDefault: () => void
}

const createCharacterInput = (event: Pick<CreateKeyboardEvent, "key">): string =>
  event.key.length === 1 ? event.key : ""

export const resetCreateView = (): CreateFlowView => createInitialFlowView()

export const cancelCreate = (
  context: BrowserActionContext,
  setCreationView: Setter<CreateFlowView>
) => {
  setCreationView(resetCreateView())
  context.setActiveScreen(menuScreen())
  context.setMessage("Create cancelled.")
}

export const setCreateBuffer = (
  creationView: CreateFlowView,
  setCreationView: Setter<CreateFlowView>,
  buffer: string
) => {
  setCreationView({ ...creationView, buffer, inputError: null })
}

const resolveCreateSubmitResult = (
  creationContext: { readonly cwd: string; readonly projectsRoot: string },
  creationView: CreateFlowView,
  mode: CreateSubmitMode
): ReturnType<typeof advanceCreateFlow> => {
  if (isDisplayModeFlowView(creationView)) {
    const applyDisplaySettingsStep = mode === "advance"
      ? advanceCreateDisplaySettingsStep
      : completeCreateDisplaySettingsFlow
    return applyDisplaySettingsStep(creationContext, creationView)
  }
  const next = advanceCreateFlow(creationContext, creationView, { quickCreate: mode === "quick-create" })
  return next?._tag === "Continue" ? { ...next, view: createDisplayFlowView(next.view) } : next
}

export const submitCreateView = (
  {
    context,
    controllerCwd,
    creationView,
    mode,
    projectsRoot,
    setCreationView
  }: CreateSubmitArgs
): void => {
  if (isCreateFlowRepoStep(creationView) && creationView.buffer.trim().length === 0) {
    setCreationView({ ...creationView, inputError: emptyRepoUrlInputError })
    return
  }

  if (!isGithubAuthConfigured(context)) {
    return
  }

  const creationContext = { cwd: controllerCwd, projectsRoot }
  const next = resolveCreateSubmitResult(creationContext, creationView, mode)
  handleAdvanceCreateFlowResult(next, {
    onError: (error) => {
      context.setMessage(formatParseError(error))
    },
    onContinue: (view) => {
      setCreationView(view)
      context.setMessage(null)
    },
    onComplete: (inputs) => {
      submitCreateInputs(inputs, context)
      setCreationView(resetCreateView())
    }
  })
}

export const useCreateMenuReset = (
  currentMenu: BrowserMenuTag,
  setCreationView: Setter<CreateFlowView>
) => {
  useEffect(() => {
    if (currentMenu !== "Create") {
      setCreationView(resetCreateView())
    }
  }, [currentMenu, setCreationView])
}

const didHandleCreateVerticalArrow = (
  event: CreateKeyboardEvent,
  creationView: DisplayModeFlowView,
  setCreationView: Setter<CreateFlowView>,
  context: BrowserActionContext
): boolean => {
  const nextView = moveCreateDisplaySettingsStep(creationView, event.key === "ArrowUp" ? "up" : "down")
  if (nextView === null) {
    return false
  }
  event.preventDefault()
  setCreationView(nextView)
  context.setMessage(null)
  return true
}

const didHandleCreateHorizontalArrow = (
  event: CreateKeyboardEvent,
  creationView: DisplayModeFlowView,
  setCreationView: Setter<CreateFlowView>,
  context: BrowserActionContext
): boolean => {
  const nextBuffer = resolveCreateSettingsChoiceBuffer(
    creationView,
    event.key === "ArrowLeft" ? "left" : "right"
  )
  if (nextBuffer === null) {
    return false
  }
  event.preventDefault()
  setCreateBuffer(creationView, setCreationView, nextBuffer)
  context.setMessage(null)
  return true
}

const submitCreateFromKeyboard = (
  event: CreateKeyboardEvent,
  { context, controllerCwd, creationView, projectsRoot, setCreationView }: CreateKeyArgs
): void => {
  event.preventDefault()
  submitCreateView({
    context,
    controllerCwd,
    projectsRoot,
    creationView,
    mode: event.shiftKey && isCreateFlowRepoStep(creationView) ? "quick-create" : "advance",
    setCreationView
  })
}

const handleCreateArrowKey = (
  event: CreateKeyboardEvent,
  creationView: CreateFlowView,
  setCreationView: Setter<CreateFlowView>,
  context: BrowserActionContext
): boolean | null => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    return isDisplayModeFlowView(creationView)
      ? didHandleCreateVerticalArrow(event, creationView, setCreationView, context)
      : false
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    return isDisplayModeFlowView(creationView)
      ? didHandleCreateHorizontalArrow(event, creationView, setCreationView, context)
      : false
  }
  return null
}

const didHandleCreateTextKey = (
  event: CreateKeyboardEvent,
  creationView: CreateFlowView,
  setCreationView: Setter<CreateFlowView>
): boolean => {
  const nextBuffer = nextBufferValue(
    createCharacterInput(event),
    { backspace: event.key === "Backspace", delete: event.key === "Delete" },
    creationView.buffer
  )
  if (nextBuffer === null) {
    return false
  }
  event.preventDefault()
  setCreateBuffer(creationView, setCreationView, nextBuffer)
  return true
}

export const didHandleCreateKey = (
  event: CreateKeyboardEvent,
  { context, controllerCwd, creationView, projectsRoot, setCreationView }: CreateKeyArgs
): boolean => {
  if (event.key === "Escape") {
    event.preventDefault()
    cancelCreate(context, setCreationView)
    return true
  }
  const arrowHandled = handleCreateArrowKey(event, creationView, setCreationView, context)
  if (arrowHandled !== null) {
    return arrowHandled
  }
  if (event.key === "Enter") {
    submitCreateFromKeyboard(event, { context, controllerCwd, creationView, projectsRoot, setCreationView })
    return true
  }
  return didHandleCreateTextKey(event, creationView, setCreationView)
}
