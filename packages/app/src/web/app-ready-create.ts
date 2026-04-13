import { type Dispatch, type SetStateAction, useEffect } from "react"

import { nextBufferValue } from "../docker-git/menu-buffer-input.js"
import { advanceCreateFlow, type CreateFlowView, createInitialFlowView } from "../docker-git/menu-create-shared.js"
import { submitCreateInputs } from "./actions-projects.js"
import { requireGithubAuthConfigured } from "./actions-shared.js"
import type { BrowserActionContext } from "./actions.js"
import type { BrowserMenuTag } from "./menu.js"

type Setter<A> = Dispatch<SetStateAction<A>>

type CreateKeyArgs = {
  readonly context: BrowserActionContext
  readonly controllerCwd: string
  readonly projectsRoot: string
  readonly createView: CreateFlowView
  readonly setCreateView: Setter<CreateFlowView>
}

type CreateSubmitArgs = CreateKeyArgs & {
  readonly forceWizard?: boolean
}

const createCharacterInput = (event: KeyboardEvent): string => event.key.length === 1 ? event.key : ""

export const resetCreateView = (): CreateFlowView => createInitialFlowView()

export const cancelCreate = (
  context: BrowserActionContext,
  setCreateView: Setter<CreateFlowView>
) => {
  setCreateView(resetCreateView())
  context.setMessage("Create cancelled.")
}

export const setCreateBuffer = (
  createView: CreateFlowView,
  setCreateView: Setter<CreateFlowView>,
  buffer: string
) => {
  setCreateView({ ...createView, buffer })
}

export const submitCreateView = (
  {
    context,
    controllerCwd,
    createView,
    forceWizard,
    projectsRoot,
    setCreateView
  }: CreateSubmitArgs
): void => {
  if (!requireGithubAuthConfigured(context)) {
    return
  }

  const createContext = { cwd: controllerCwd, projectsRoot }
  const next = forceWizard === true
    ? advanceCreateFlow(createContext, createView, { forceWizard: true })
    : advanceCreateFlow(createContext, createView)
  if (next === null) {
    return
  }
  if (next._tag === "Continue") {
    setCreateView(next.view)
    context.setMessage(null)
    return
  }
  submitCreateInputs(next.inputs, context)
  setCreateView(resetCreateView())
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

export const handleCreateKey = (
  event: KeyboardEvent,
  { context, controllerCwd, createView, projectsRoot, setCreateView }: CreateKeyArgs
): boolean => {
  if (event.key === "Escape") {
    event.preventDefault()
    cancelCreate(context, setCreateView)
    return true
  }
  if (event.key === "Enter") {
    event.preventDefault()
    submitCreateView({
      context,
      controllerCwd,
      projectsRoot,
      createView,
      forceWizard: event.shiftKey,
      setCreateView
    })
    return true
  }

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
