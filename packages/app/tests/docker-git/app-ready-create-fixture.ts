import type { Dispatch, SetStateAction } from "react"
import { expect, vi } from "vitest"

import {
  type CreateFlowView,
  createInitialFlowView,
  type DisplayModeFlowView,
  resolveCreateDisplaySteps
} from "../../src/docker-git/menu-create-shared.js"
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

type HandleCreateKey = typeof AppReadyCreate.didHandleCreateKey
type SubmitCreateView = typeof AppReadyCreate.submitCreateView
type CreateSubmitMode = AppReadyCreate.CreateSubmitMode
type BrowserActionContextOverrides = Parameters<typeof makeBrowserActionContext>[0]
type SubmitCreateOptions = { readonly mode?: CreateSubmitMode }
export type SubmitCreateInputsMock = ReturnType<typeof vi.fn<typeof submitCreateInputs>>

export const EMPTY_REPO_URL_ERROR = "Insert URL first"

/** @pure true @effect none @invariant exposes one valid GitHub token @precondition n/a @postcondition auth gate accepts Create actions @complexity O(1) */
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

/** @pure false @effect allocates a Vitest spy @invariant setter and spy observe the same calls @precondition n/a @postcondition returned setter is React-compatible @complexity O(1) */
export const createSetCreateViewSpy = () => {
  const spy = vi.fn<(value: SetStateAction<CreateFlowView>) => void>()
  const setCreationView: Dispatch<SetStateAction<CreateFlowView>> = spy
  return { setCreationView, spy }
}

type SetCreateViewSpy = ReturnType<typeof createSetCreateViewSpy>["spy"]

/** @pure true @effect none @invariant function updates are rejected @precondition value is a captured setState argument @postcondition returns a concrete CreateFlowView @complexity O(1) */
export const requireCreateViewValue = (
  value: SetStateAction<CreateFlowView> | undefined
): CreateFlowView => {
  if (value === undefined || typeof value === "function") {
    throw new Error("Expected CreateFlowView value.")
  }
  return value
}

/** @pure false @effect Vitest assertion @invariant selected call equals expected view @precondition callIndex targets a setCreationView call @postcondition assertion records no mutation @complexity O(1) */
export const expectCreateViewUpdate = (
  setCreateViewSpy: SetCreateViewSpy,
  expected: CreateFlowView,
  callIndex = 0
) => {
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[callIndex]?.[0])).toEqual(expected)
}

/** @pure false @effect Vitest assertion @invariant inline error text is exact @precondition submit path attempted empty repo URL @postcondition expected error view was written @complexity O(1) */
export const expectCreateViewInputError = (
  setCreateViewSpy: SetCreateViewSpy,
  view: CreateFlowView
) => {
  expectCreateViewUpdate(setCreateViewSpy, {
    ...view,
    inputError: EMPTY_REPO_URL_ERROR
  })
}

/** @pure false @effect invokes submitCreateView test subject @invariant mode defaults to advance @precondition buffer is a repo-step buffer @postcondition returns captured action context and setter spy @complexity O(1) */
export const submitCreateBuffer = (
  submitCreateView: SubmitCreateView,
  buffer: string,
  options: SubmitCreateOptions = {}
) => {
  const { context, setCreateViewSpy } = runSubmitCreateView(
    submitCreateView,
    createInitialFlowView(buffer),
    options
  )

  return { context, setCreateViewSpy }
}

/** @pure true @effect none @invariant at least one submit call must exist @precondition submit mock has been exercised @postcondition returns the first submitted CreateInputs @complexity O(1) */
export const requireSubmittedCreateInputs = (
  submitCreateInputsMock: SubmitCreateInputsMock
): CreateInputs => {
  const inputs = submitCreateInputsMock.mock.calls[0]?.[0]
  if (inputs === undefined) {
    throw new Error("Expected submitted CreateInputs.")
  }
  return inputs
}

/** @pure false @effect Vitest assertion @invariant default quick-create fields remain stable @precondition submit mock has one CreateInputs call @postcondition submitted inputs equal expected defaults plus repo fields @complexity O(1) */
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

/** @pure false @effect Vitest assertion @invariant reset view equals initial create mode @precondition Create flow completed @postcondition setter received createInitialFlowView() @complexity O(1) */
export const expectCreateViewReset = (
  setCreateViewSpy: SetCreateViewSpy
) => {
  expectCreateViewUpdate(setCreateViewSpy, createInitialFlowView())
}

/** @pure true @effect none @invariant wraps a fixed submitCreateView implementation @precondition submitCreateView is the test subject @postcondition returned helper delegates to submitCreateBuffer @complexity O(1) */
export const createSubmitCreateBuffer = (submitCreateView: SubmitCreateView) =>
(
  buffer: string,
  options: SubmitCreateOptions = {}
) => submitCreateBuffer(submitCreateView, buffer, options)

/** @pure false @effect allocates a Vitest preventDefault spy @invariant shiftKey is preserved @precondition key is a browser keyboard key @postcondition event matches didHandleCreateKey input shape @complexity O(1) */
export const createKeyEvent = (
  key: string,
  hasShiftKey = false
): Parameters<HandleCreateKey>[0] => {
  const event = {
    key,
    shiftKey: hasShiftKey,
    preventDefault: vi.fn()
  }
  return event
}

/** @pure true @effect none @invariant mode is display and repo values are committed @precondition n/a @postcondition settings tests start after the repo step @complexity O(1) */
export const createSettingsFlowView = (): DisplayModeFlowView => ({
  mode: "display",
  step: 1,
  buffer: "30%",
  inputError: null,
  values: {
    outDir: "/home/dev/.docker-git/org/repo",
    repoRef: "feature-x",
    repoUrl: featureCreateRepoUrl
  }
})

/** @pure true @effect none @invariant returned view remains in display mode @precondition stepName is a Create step @postcondition step points at the requested display row @complexity O(1) */
export const createSettingsFlowViewAtStep = (
  stepName: CreateStep,
  buffer = "draft"
): DisplayModeFlowView => ({
  ...createSettingsFlowView(),
  buffer,
  step: resolveRequiredCreateStepIndex(stepName, resolveCreateDisplaySteps())
})

const createActionFrame = (
  contextOverrides?: BrowserActionContextOverrides
) => {
  const { context } = makeBrowserActionContext(contextOverrides ?? { githubStatus: validGithubStatus })
  const { setCreationView, spy: setCreateViewSpy } = createSetCreateViewSpy()
  return { context, setCreationView, setCreateViewSpy }
}

/** @pure false @effect invokes didHandleCreateKey test subject @invariant controller cwd and projectsRoot are stable @precondition creationView is a test snapshot @postcondition returns event, context, and setter spy @complexity O(1) */
export const runCreateKey = (
  didHandleCreateKey: HandleCreateKey,
  view: CreateFlowView,
  key: string,
  options: {
    readonly contextOverrides?: BrowserActionContextOverrides
    readonly shiftKey?: boolean
  } = {}
) => {
  const frame = createActionFrame(options.contextOverrides)
  const event = createKeyEvent(key, options.shiftKey ?? false)
  const isHandled = didHandleCreateKey(event, {
    context: frame.context,
    controllerCwd: "/workspace",
    creationView: view,
    projectsRoot: "/home/dev/.docker-git",
    setCreationView: frame.setCreationView
  })
  return { ...frame, event, handled: isHandled }
}

const expectHandledCreateKey = (
  result: Pick<ReturnType<typeof runCreateKey>, "event" | "handled">
) => {
  expect(result.handled).toBe(true)
  expect(result.event.preventDefault).toHaveBeenCalledTimes(1)
}

/** @pure false @effect Vitest assertion @invariant ignored keys do not update view or message @precondition key has no action for creationView @postcondition no preventDefault call is made @complexity O(1) */
export const expectIgnoredCreateKey = (
  didHandleCreateKey: HandleCreateKey,
  view: CreateFlowView,
  key: "ArrowDown" | "ArrowLeft" | "ArrowRight"
) => {
  const result = runCreateKey(didHandleCreateKey, view, key)

  expect(result.handled).toBe(false)
  expect(result.event.preventDefault).not.toHaveBeenCalled()
  expect(result.setCreateViewSpy).not.toHaveBeenCalled()
  expect(result.context.setMessage).not.toHaveBeenCalled()
}

/** @pure false @effect invokes submitCreateView test subject @invariant mode defaults to advance @precondition creationView is a test snapshot @postcondition returns action context and setter spy @complexity O(1) */
export const runSubmitCreateView = (
  submitCreateView: SubmitCreateView,
  creationView: CreateFlowView,
  options: {
    readonly contextOverrides?: BrowserActionContextOverrides
    readonly mode?: CreateSubmitMode
  } = {}
) => {
  const frame = createActionFrame(options.contextOverrides)
  submitCreateView({
    context: frame.context,
    controllerCwd: "/workspace",
    creationView,
    projectsRoot: "/home/dev/.docker-git",
    mode: options.mode ?? "advance",
    setCreationView: frame.setCreationView
  })
  return frame
}

/** @pure false @effect Vitest assertion @invariant vertical arrows clear preview buffers @precondition create settings flow is active @postcondition selected step equals expectedStep(view) @complexity O(1) */
export const expectCreateArrowHandling = (
  didHandleCreateKey: HandleCreateKey,
  key: "ArrowDown" | "ArrowUp",
  expectedStep: (view: CreateFlowView) => number
) => {
  const creationView = createSettingsFlowView()
  const result = runCreateKey(didHandleCreateKey, creationView, key)
  const nextView = requireCreateViewValue(result.setCreateViewSpy.mock.calls[0]?.[0])

  expectHandledCreateKey(result)
  expect(nextView.step).toBe(expectedStep(creationView))
  expect(nextView.buffer).toBe("")
  expect(nextView.values).toEqual(creationView.values)
  expect(result.context.setMessage).toHaveBeenCalledWith(null)
}

/** @pure false @effect Vitest assertion @invariant side arrows only update buffer @precondition stepName supports or rejects discrete choice as expected @postcondition committed values and submit mock are unchanged @complexity O(1) */
export const expectCreateSideArrowBufferHandling = (
  didHandleCreateKey: HandleCreateKey,
  submitCreateInputsMock: SubmitCreateInputsMock,
  key: "ArrowLeft" | "ArrowRight",
  stepName: CreateStep,
  expectedBuffer: string
) => {
  const creationView = createSettingsFlowViewAtStep(stepName, "typed")
  const result = runCreateKey(didHandleCreateKey, creationView, key)
  const { context, setCreateViewSpy } = result

  expectHandledCreateKey(result)
  expectCreateViewUpdate(setCreateViewSpy, {
    ...creationView,
    buffer: expectedBuffer
  })
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0]).values).toEqual(creationView.values)
  expect(submitCreateInputsMock).not.toHaveBeenCalled()
  expect(context.setMessage).toHaveBeenCalledWith(null)
}

/** @pure false @effect Vitest assertion @invariant empty repo URL never submits @precondition submitCreateView is the test subject @postcondition inline error is set before auth checks @complexity O(1) */
export const expectEmptyRepoInlineError = (
  submitCreateView: SubmitCreateView,
  submitCreateInputsMock: SubmitCreateInputsMock,
  mode: CreateSubmitMode = "advance"
) => {
  const creationView = createInitialFlowView(" ".repeat(3))
  const { context, setCreateViewSpy } = runSubmitCreateView(submitCreateView, creationView, { mode })

  expect(submitCreateInputsMock).not.toHaveBeenCalled()
  expect(setCreateViewSpy).toHaveBeenCalledTimes(1)
  expectCreateViewInputError(setCreateViewSpy, creationView)
  expect(context.setMessage).not.toHaveBeenCalled()
}

/** @pure false @effect Vitest assertion @invariant Enter and Shift+Enter share empty repo validation @precondition didHandleCreateKey is the test subject @postcondition inline error is set and submit is skipped @complexity O(1) */
export const expectEmptyRepoKeyboardInlineError = (
  didHandleCreateKey: HandleCreateKey,
  submitCreateInputsMock: SubmitCreateInputsMock,
  hasShiftKey: boolean
) => {
  const creationView = createInitialFlowView("")
  const result = runCreateKey(didHandleCreateKey, creationView, "Enter", { shiftKey: hasShiftKey })
  const { context, setCreateViewSpy } = result

  expectHandledCreateKey(result)
  expect(submitCreateInputsMock).not.toHaveBeenCalled()
  expectCreateViewInputError(setCreateViewSpy, creationView)
  expect(context.setMessage).not.toHaveBeenCalled()
}
