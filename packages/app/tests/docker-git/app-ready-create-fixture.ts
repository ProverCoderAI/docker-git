import type { Dispatch, SetStateAction } from "react"
import { expect, vi } from "vitest"

import { type CreateFlowView, createInitialFlowView } from "../../src/docker-git/menu-create-shared.js"
import type { CreateInputs, CreateStep } from "../../src/docker-git/menu-types.js"
import type { submitCreateInputs } from "../../src/web/actions-projects.js"
import type { GithubAuthStatus } from "../../src/web/api.js"
import type * as AppReadyCreate from "../../src/web/app-ready-create.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"
import { featureCreateRepoUrl, resolveRequiredCreateStepIndex } from "./create-flow-test-helpers.js"

export {
  createInitialFlowView,
  resolveCreateDisplaySteps,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"
export type { CreateFlowView } from "../../src/docker-git/menu-create-shared.js"
export type { CreateStep } from "../../src/docker-git/menu-types.js"

type HandleCreateKey = typeof AppReadyCreate.handleCreateKey
type SubmitCreateView = typeof AppReadyCreate.submitCreateView
type BrowserActionContextOverrides = Parameters<typeof makeBrowserActionContext>[0]
export type SubmitCreateInputsMock = ReturnType<typeof vi.fn<typeof submitCreateInputs>>

export const validGithubStatus: GithubAuthStatus = {
  summary: "valid",
  tokens: [{ key: "default", label: "default", login: "octocat", status: "valid" }]
}

const defaultQuickCreateInputs = {
  cpuLimit: "",
  enableMcpPlaywright: false,
  force: false,
  forceEnv: false,
  gpu: "none",
  ramLimit: "",
  runUp: true
} satisfies Omit<CreateInputs, "outDir" | "repoRef" | "repoUrl">

export const createSetCreateViewSpy = () => {
  const spy = vi.fn<(value: SetStateAction<CreateFlowView>) => void>()
  const setCreateView: Dispatch<SetStateAction<CreateFlowView>> = spy
  return { setCreateView, spy }
}

type SetCreateViewSpy = ReturnType<typeof createSetCreateViewSpy>["spy"]

export const requireCreateViewValue = (
  value: SetStateAction<CreateFlowView> | undefined
): CreateFlowView => {
  if (value === undefined || typeof value === "function") {
    throw new Error("Expected CreateFlowView value.")
  }
  return value
}

export const expectCreateViewUpdate = (
  setCreateViewSpy: SetCreateViewSpy,
  expected: CreateFlowView,
  callIndex = 0
) => {
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[callIndex]?.[0])).toEqual(expected)
}

export const expectCreateViewInputError = (
  setCreateViewSpy: SetCreateViewSpy,
  createView: CreateFlowView
) => {
  expectCreateViewUpdate(setCreateViewSpy, {
    ...createView,
    inputError: "Insert URL first"
  })
}

export const submitCreateBuffer = (
  submitCreateView: SubmitCreateView,
  buffer: string,
  options: { readonly quickCreate?: boolean } = {}
) => {
  const quickCreate = options.quickCreate === undefined ? {} : { quickCreate: options.quickCreate }
  const { context, setCreateViewSpy } = runSubmitCreateView(
    submitCreateView,
    createInitialFlowView(buffer),
    quickCreate
  )

  return { context, setCreateViewSpy }
}

export const requireSubmittedCreateInputs = (
  submitCreateInputsMock: SubmitCreateInputsMock
): CreateInputs => {
  const inputs = submitCreateInputsMock.mock.calls[0]?.[0]
  if (inputs === undefined) {
    throw new Error("Expected submitted CreateInputs.")
  }
  return inputs
}

export const expectQuickCreateInputs = (
  submitCreateInputsMock: SubmitCreateInputsMock,
  expected: Pick<CreateInputs, "outDir" | "repoRef" | "repoUrl">
) => {
  expect(requireSubmittedCreateInputs(submitCreateInputsMock)).toEqual(
    {
      ...defaultQuickCreateInputs,
      ...expected
    } satisfies CreateInputs
  )
}

export const expectCreateViewReset = (
  setCreateViewSpy: SetCreateViewSpy
) => {
  expectCreateViewUpdate(setCreateViewSpy, createInitialFlowView())
}

export const createSubmitCreateBuffer = (submitCreateView: SubmitCreateView) =>
(
  buffer: string,
  options: { readonly quickCreate?: boolean } = {}
) => submitCreateBuffer(submitCreateView, buffer, options)

export const createKeyEvent = (
  key: string,
  shiftKey = false
): Parameters<HandleCreateKey>[0] => {
  const event = {
    key,
    shiftKey,
    preventDefault: vi.fn()
  }
  return event
}

export const createSettingsFlowView = (): CreateFlowView => ({
  step: 1,
  buffer: "30%",
  inputError: null,
  values: {
    outDir: "/home/dev/.docker-git/org/repo",
    repoRef: "feature-x",
    repoUrl: featureCreateRepoUrl
  }
})

export const createSettingsFlowViewAtStep = (
  stepName: CreateStep,
  buffer = "draft"
): CreateFlowView => ({
  ...createSettingsFlowView(),
  buffer,
  step: resolveRequiredCreateStepIndex(stepName)
})

const createActionFrame = (
  contextOverrides?: BrowserActionContextOverrides
) => {
  const { context } = makeBrowserActionContext(contextOverrides ?? { githubStatus: validGithubStatus })
  const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
  return { context, setCreateView, setCreateViewSpy }
}

export const runCreateKey = (
  handleCreateKey: HandleCreateKey,
  createView: CreateFlowView,
  key: string,
  options: {
    readonly contextOverrides?: BrowserActionContextOverrides
    readonly shiftKey?: boolean
  } = {}
) => {
  const frame = createActionFrame(options.contextOverrides)
  const event = createKeyEvent(key, options.shiftKey ?? false)
  const handled = handleCreateKey(event, {
    context: frame.context,
    controllerCwd: "/workspace",
    createView,
    projectsRoot: "/home/dev/.docker-git",
    setCreateView: frame.setCreateView
  })
  return { ...frame, event, handled }
}

const expectHandledCreateKey = (
  result: Pick<ReturnType<typeof runCreateKey>, "event" | "handled">
) => {
  expect(result.handled).toBe(true)
  expect(result.event.preventDefault).toHaveBeenCalledTimes(1)
}

export const expectIgnoredCreateKey = (
  handleCreateKey: HandleCreateKey,
  createView: CreateFlowView,
  key: "ArrowDown" | "ArrowLeft" | "ArrowRight"
) => {
  const result = runCreateKey(handleCreateKey, createView, key)

  expect(result.handled).toBe(false)
  expect(result.event.preventDefault).not.toHaveBeenCalled()
  expect(result.setCreateViewSpy).not.toHaveBeenCalled()
  expect(result.context.setMessage).not.toHaveBeenCalled()
}

export const runSubmitCreateView = (
  submitCreateView: SubmitCreateView,
  createView: CreateFlowView,
  options: {
    readonly contextOverrides?: BrowserActionContextOverrides
    readonly quickCreate?: boolean
  } = {}
) => {
  const frame = createActionFrame(options.contextOverrides)
  submitCreateView({
    context: frame.context,
    controllerCwd: "/workspace",
    createView,
    projectsRoot: "/home/dev/.docker-git",
    quickCreate: options.quickCreate,
    setCreateView: frame.setCreateView
  })
  return frame
}

export const expectCreateArrowHandling = (
  handleCreateKey: HandleCreateKey,
  key: "ArrowDown" | "ArrowUp",
  expectedStep: (view: CreateFlowView) => number
) => {
  const createView = createSettingsFlowView()
  const result = runCreateKey(handleCreateKey, createView, key)
  const nextView = requireCreateViewValue(result.setCreateViewSpy.mock.calls[0]?.[0])

  expectHandledCreateKey(result)
  expect(nextView.step).toBe(expectedStep(createView))
  expect(nextView.buffer).toBe("")
  expect(nextView.values).toEqual(createView.values)
  expect(result.context.setMessage).toHaveBeenCalledWith(null)
}

export const expectCreateSideArrowBufferHandling = (
  handleCreateKey: HandleCreateKey,
  submitCreateInputsMock: SubmitCreateInputsMock,
  key: "ArrowLeft" | "ArrowRight",
  stepName: CreateStep,
  expectedBuffer: string
) => {
  const createView = createSettingsFlowViewAtStep(stepName, "typed")
  const result = runCreateKey(handleCreateKey, createView, key)
  const { context, setCreateViewSpy } = result

  expectHandledCreateKey(result)
  expectCreateViewUpdate(setCreateViewSpy, {
    ...createView,
    buffer: expectedBuffer
  })
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0]).values).toEqual(createView.values)
  expect(submitCreateInputsMock).not.toHaveBeenCalled()
  expect(context.setMessage).toHaveBeenCalledWith(null)
}

export const expectEmptyRepoInlineError = (
  submitCreateView: SubmitCreateView,
  submitCreateInputsMock: SubmitCreateInputsMock,
  quickCreate?: boolean
) => {
  const createView = createInitialFlowView("   ")
  const quickCreateOption = quickCreate === undefined ? {} : { quickCreate }
  const { context, setCreateViewSpy } = runSubmitCreateView(submitCreateView, createView, quickCreateOption)

  expect(submitCreateInputsMock).not.toHaveBeenCalled()
  expect(setCreateViewSpy).toHaveBeenCalledTimes(1)
  expectCreateViewInputError(setCreateViewSpy, createView)
  expect(context.setMessage).not.toHaveBeenCalled()
}

export const expectEmptyRepoKeyboardInlineError = (
  handleCreateKey: HandleCreateKey,
  submitCreateInputsMock: SubmitCreateInputsMock,
  shiftKey: boolean
) => {
  const createView = createInitialFlowView("")
  const result = runCreateKey(handleCreateKey, createView, "Enter", { shiftKey })
  const { context, setCreateViewSpy } = result

  expectHandledCreateKey(result)
  expect(submitCreateInputsMock).not.toHaveBeenCalled()
  expectCreateViewInputError(setCreateViewSpy, createView)
  expect(context.setMessage).not.toHaveBeenCalled()
}
