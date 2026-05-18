import { type Dispatch, type SetStateAction, useEffect } from "react"

import { formatParseError } from "../docker-git/cli/usage.js"
import { nextBufferValue } from "../docker-git/menu-buffer-input.js"
import {
  advanceCreateFlow,
  applyCreateDisplaySettingsStep,
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
import { requireGithubAuthConfigured } from "./actions-shared.js"
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
  readonly createView: CreateFlowView
  readonly setCreateView: Setter<CreateFlowView>
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
  setCreateView: Setter<CreateFlowView>
) => {
  setCreateView(resetCreateView())
  context.setActiveScreen(menuScreen())
  context.setMessage("Create cancelled.")
}

export const setCreateBuffer = (
  createView: CreateFlowView,
  setCreateView: Setter<CreateFlowView>,
  buffer: string
) => {
  setCreateView({ ...createView, buffer, inputError: null })
}

const resolveCreateSubmitResult = (
  createContext: { readonly cwd: string; readonly projectsRoot: string },
  createView: CreateFlowView,
  mode: CreateSubmitMode
): ReturnType<typeof advanceCreateFlow> => {
  if (isDisplayModeFlowView(createView)) {
    return mode === "advance"
      ? applyCreateDisplaySettingsStep(createContext, createView)
      : completeCreateDisplaySettingsFlow(createContext, createView)
  }
  const next = advanceCreateFlow(createContext, createView, { quickCreate: mode === "quick-create" })
  return next?._tag === "Continue" ? { ...next, view: createDisplayFlowView(next.view) } : next
}

export const submitCreateView = (
  {
    context,
    controllerCwd,
    createView,
    mode,
    projectsRoot,
    setCreateView
  }: CreateSubmitArgs
): void => {
  if (isCreateFlowRepoStep(createView) && createView.buffer.trim().length === 0) {
    setCreateView({ ...createView, inputError: emptyRepoUrlInputError })
    return
  }

  if (!requireGithubAuthConfigured(context)) {
    return
  }

  const createContext = { cwd: controllerCwd, projectsRoot }
  const next = resolveCreateSubmitResult(createContext, createView, mode)
  handleAdvanceCreateFlowResult(next, {
    onError: (error) => {
      context.setMessage(formatParseError(error))
    },
    onContinue: (view) => {
      setCreateView(view)
      context.setMessage(null)
    },
    onComplete: (inputs) => {
      submitCreateInputs(inputs, context)
      setCreateView(resetCreateView())
    }
  })
}

export const useCreateMenuReset = (
  currentMenu: BrowserMenuTag,
  setCreateView: Setter<CreateFlowView>
) => {
  useEffect(() => {
    if (currentMenu !== "Create") {
      setCreateView(resetCreateView())
    }
  }, [currentMenu, setCreateView])
}

const handleCreateVerticalArrow = (
  event: CreateKeyboardEvent,
  createView: DisplayModeFlowView,
  setCreateView: Setter<CreateFlowView>,
  context: BrowserActionContext
): boolean => {
  const nextView = moveCreateDisplaySettingsStep(createView, event.key === "ArrowUp" ? "up" : "down")
  if (nextView === null) {
    return false
  }
  event.preventDefault()
  setCreateView(nextView)
  context.setMessage(null)
  return true
}

const handleCreateHorizontalArrow = (
  event: CreateKeyboardEvent,
  createView: DisplayModeFlowView,
  setCreateView: Setter<CreateFlowView>,
  context: BrowserActionContext
): boolean => {
  const nextBuffer = resolveCreateSettingsChoiceBuffer(
    createView,
    event.key === "ArrowLeft" ? "left" : "right"
  )
  if (nextBuffer === null) {
    return false
  }
  event.preventDefault()
  setCreateBuffer(createView, setCreateView, nextBuffer)
  context.setMessage(null)
  return true
}

const submitCreateFromKeyboard = (
  event: CreateKeyboardEvent,
  { context, controllerCwd, createView, projectsRoot, setCreateView }: CreateKeyArgs
): void => {
  event.preventDefault()
  submitCreateView({
    context,
    controllerCwd,
    projectsRoot,
    createView,
    mode: event.shiftKey && isCreateFlowRepoStep(createView) ? "quick-create" : "advance",
    setCreateView
  })
}

const handleCreateArrowKey = (
  event: CreateKeyboardEvent,
  createView: CreateFlowView,
  setCreateView: Setter<CreateFlowView>,
  context: BrowserActionContext
): boolean | null => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    return isDisplayModeFlowView(createView)
      ? handleCreateVerticalArrow(event, createView, setCreateView, context)
      : false
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    return isDisplayModeFlowView(createView)
      ? handleCreateHorizontalArrow(event, createView, setCreateView, context)
      : false
  }
  return null
}

const handleCreateTextKey = (
  event: CreateKeyboardEvent,
  createView: CreateFlowView,
  setCreateView: Setter<CreateFlowView>
): boolean => {
  const nextBuffer = nextBufferValue(
    createCharacterInput(event),
    { backspace: event.key === "Backspace", delete: event.key === "Delete" },
    createView.buffer
  )
  if (nextBuffer === null) {
    return false
  }
  event.preventDefault()
  setCreateBuffer(createView, setCreateView, nextBuffer)
  return true
}

export const handleCreateKey = (
  event: CreateKeyboardEvent,
  { context, controllerCwd, createView, projectsRoot, setCreateView }: CreateKeyArgs
): boolean => {
  if (event.key === "Escape") {
    event.preventDefault()
    cancelCreate(context, setCreateView)
    return true
  }
  const arrowHandled = handleCreateArrowKey(event, createView, setCreateView, context)
  if (arrowHandled !== null) {
    return arrowHandled
  }
  if (event.key === "Enter") {
    submitCreateFromKeyboard(event, { context, controllerCwd, createView, projectsRoot, setCreateView })
    return true
  }
  return handleCreateTextKey(event, createView, setCreateView)
}
