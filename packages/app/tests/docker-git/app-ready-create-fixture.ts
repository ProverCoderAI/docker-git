import * as fc from "fast-check"
import type { Dispatch, SetStateAction } from "react"
import { expect, vi } from "vitest"

import { deriveRepoPathParts, resolveRepoInput } from "../../src/docker-git/frontend-lib/core/domain.js"
import {
  type CreateFlowView,
  createInitialFlowView,
  resolveCreateDisplaySteps
} from "../../src/docker-git/menu-create-shared.js"
import type { CreateInputs, CreateStep } from "../../src/docker-git/menu-types.js"
import type { submitCreateInputs } from "../../src/web/actions-projects.js"
import type { GithubAuthStatus } from "../../src/web/api.js"
import type * as AppReadyCreate from "../../src/web/app-ready-create.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"

export {
  createInitialFlowView,
  resolveCreateDisplaySteps,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"
export type { CreateFlowView } from "../../src/docker-git/menu-create-shared.js"
export type { CreateStep } from "../../src/docker-git/menu-types.js"

type HandleCreateKey = typeof AppReadyCreate.handleCreateKey
type SubmitCreateView = typeof AppReadyCreate.submitCreateView
export type SubmitCreateInputsMock = ReturnType<typeof vi.fn<typeof submitCreateInputs>>

export const validGithubStatus: GithubAuthStatus = {
  summary: "valid",
  tokens: [{ key: "default", label: "default", login: "octocat", status: "valid" }]
}

const githubNameChars = "abcdefghijklmnopqrstuvwxyz0123456789-"
const githubNameCharArbitrary = fc
  .integer({ min: 0, max: githubNameChars.length - 1 })
  .map((index) => githubNameChars[index] ?? "a")

const githubSegmentArbitrary = fc
  .array(githubNameCharArbitrary, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(""))
  .filter((value) => !value.startsWith("-") && !value.endsWith("-"))

export const repositoryCreateInputArbitrary = fc.record({
  branch: fc.option(githubSegmentArbitrary, { nil: null }),
  owner: githubSegmentArbitrary,
  repo: githubSegmentArbitrary
}).map(({ branch, owner, repo }) => ({
  expectedRepoRef: branch ?? "main",
  repoUrl: branch === null
    ? `https://github.com/${owner}/${repo}`
    : `https://github.com/${owner}/${repo}/tree/${branch}`
}))

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

export const submitCreateBuffer = (
  submitCreateView: SubmitCreateView,
  buffer: string,
  options: { readonly quickCreate?: boolean } = {}
) => {
  const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
  const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
  const quickCreate = options.quickCreate === undefined ? {} : { quickCreate: options.quickCreate }

  submitCreateView({
    context,
    controllerCwd: "/workspace",
    createView: createInitialFlowView(buffer),
    projectsRoot: "/home/dev/.docker-git",
    ...quickCreate,
    setCreateView
  })

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
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toEqual(createInitialFlowView())
}

export const createSubmitCreateBuffer = (submitCreateView: SubmitCreateView) =>
(
  buffer: string,
  options: { readonly quickCreate?: boolean } = {}
) => submitCreateBuffer(submitCreateView, buffer, options)

export const expectedOutDirForRepoUrl = (repoUrl: string): string =>
  `/home/dev/.docker-git/${deriveRepoPathParts(resolveRepoInput(repoUrl).repoUrl).pathParts.join("/")}`

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
    repoUrl: "https://github.com/org/repo/tree/feature-x"
  }
})

export const createSettingsFlowViewAtStep = (
  stepName: CreateStep,
  buffer = "draft"
): CreateFlowView => {
  const view = createSettingsFlowView()
  const step = resolveCreateDisplaySteps().indexOf(stepName)
  if (step === -1) {
    throw new TypeError(`expected Create step: ${stepName}`)
  }
  return { ...view, step, buffer }
}

export const expectCreateArrowHandling = (
  handleCreateKey: HandleCreateKey,
  key: "ArrowDown" | "ArrowUp",
  expectedStep: (view: CreateFlowView) => number
) => {
  const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
  const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
  const event = createKeyEvent(key)
  const createView = createSettingsFlowView()

  const handled = handleCreateKey(event, {
    context,
    controllerCwd: "/workspace",
    createView,
    projectsRoot: "/home/dev/.docker-git",
    setCreateView
  })

  expect(handled).toBe(true)
  expect(event.preventDefault).toHaveBeenCalledTimes(1)
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toEqual({
    ...createView,
    step: expectedStep(createView),
    buffer: ""
  })
  expect(context.setMessage).toHaveBeenCalledWith(null)
}

export const expectCreateSideArrowBufferHandling = (
  handleCreateKey: HandleCreateKey,
  submitCreateInputsMock: SubmitCreateInputsMock,
  key: "ArrowLeft" | "ArrowRight",
  stepName: CreateStep,
  expectedBuffer: string
) => {
  const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
  const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
  const event = createKeyEvent(key)
  const createView = createSettingsFlowViewAtStep(stepName, "typed")

  const handled = handleCreateKey(event, {
    context,
    controllerCwd: "/workspace",
    createView,
    projectsRoot: "/home/dev/.docker-git",
    setCreateView
  })

  expect(handled).toBe(true)
  expect(event.preventDefault).toHaveBeenCalledTimes(1)
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toEqual({
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
  const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
  const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
  const createView = createInitialFlowView("   ")

  submitCreateView({
    context,
    controllerCwd: "/workspace",
    createView,
    projectsRoot: "/home/dev/.docker-git",
    quickCreate,
    setCreateView
  })

  expect(submitCreateInputsMock).not.toHaveBeenCalled()
  expect(setCreateViewSpy).toHaveBeenCalledTimes(1)
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toEqual({
    ...createView,
    inputError: "Insert URL first"
  })
  expect(context.setMessage).not.toHaveBeenCalled()
}
