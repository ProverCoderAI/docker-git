import * as fc from "fast-check"
import type { Dispatch, SetStateAction } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { deriveRepoPathParts, resolveRepoInput } from "../../src/docker-git/frontend-lib/core/domain.js"
import {
  type CreateFlowView,
  createInitialFlowView,
  resolveCreateDisplaySteps,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"
import type { CreateInputs, CreateStep } from "../../src/docker-git/menu-types.js"
import type { submitCreateInputs } from "../../src/web/actions-projects.js"
import type { GithubAuthStatus } from "../../src/web/api.js"
import { handleCreateKey, submitCreateView } from "../../src/web/app-ready-create.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"

const submitCreateInputsMock = vi.hoisted(() => vi.fn<typeof submitCreateInputs>())

vi.mock("../../src/web/actions-projects.js", () => ({
  submitCreateInputs: submitCreateInputsMock
}))

const validGithubStatus: GithubAuthStatus = {
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

const repositoryCreateInputArbitrary = fc.record({
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

const createSetCreateViewSpy = () => {
  const spy = vi.fn<(value: SetStateAction<CreateFlowView>) => void>()
  const setCreateView: Dispatch<SetStateAction<CreateFlowView>> = spy
  return { setCreateView, spy }
}

const requireCreateViewValue = (
  value: SetStateAction<CreateFlowView> | undefined
): CreateFlowView => {
  if (value === undefined || typeof value === "function") {
    throw new Error("Expected CreateFlowView value.")
  }
  return value
}

const submitCreateBuffer = (
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

const requireSubmittedCreateInputs = (): CreateInputs => {
  const inputs = submitCreateInputsMock.mock.calls[0]?.[0]
  if (inputs === undefined) {
    throw new Error("Expected submitted CreateInputs.")
  }
  return inputs
}

const expectQuickCreateInputs = (
  expected: Pick<CreateInputs, "outDir" | "repoRef" | "repoUrl">
) => {
  expect(requireSubmittedCreateInputs()).toEqual(
    {
      ...defaultQuickCreateInputs,
      ...expected
    } satisfies CreateInputs
  )
}

const expectCreateViewReset = (setCreateViewSpy: ReturnType<typeof submitCreateBuffer>["setCreateViewSpy"]) => {
  expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toEqual(createInitialFlowView())
}

const expectedOutDirForRepoUrl = (repoUrl: string): string =>
  `/home/dev/.docker-git/${deriveRepoPathParts(resolveRepoInput(repoUrl).repoUrl).pathParts.join("/")}`

const createKeyEvent = (
  key: string,
  shiftKey = false
): Parameters<typeof handleCreateKey>[0] => {
  const event = {
    key,
    shiftKey,
    preventDefault: vi.fn()
  }
  return event
}

const createSettingsFlowView = (): CreateFlowView => ({
  step: 1,
  buffer: "30%",
  values: {
    outDir: "/home/dev/.docker-git/org/repo",
    repoRef: "feature-x",
    repoUrl: "https://github.com/org/repo/tree/feature-x"
  }
})

const createSettingsFlowViewAtStep = (
  stepName: CreateStep,
  buffer = "draft"
): CreateFlowView => {
  const view = createSettingsFlowView()
  const step = resolveCreateDisplaySteps().indexOf(stepName)
  if (step < 0) {
    throw new TypeError(`expected Create step: ${stepName}`)
  }
  return { ...view, step, buffer }
}

const expectCreateArrowHandling = (
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

const expectCreateSideArrowBufferHandling = (
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

describe("app-ready-create", () => {
  beforeEach(() => {
    submitCreateInputsMock.mockReset()
  })

  it("advances to the next create field on Enter for a repo URL", () => {
    const { context, setCreateViewSpy } = submitCreateBuffer("https://github.com/org/repo/tree/feature-x --force")

    expect(setCreateViewSpy).toHaveBeenCalledTimes(1)
    const nextView = requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])
    expect(nextView).toMatchObject({
      step: 1,
      values: {
        force: true,
        outDir: "/home/dev/.docker-git/org/repo",
        repoRef: "feature-x",
        repoUrl: "https://github.com/org/repo/tree/feature-x"
      }
    })
    expect(resolveCreateFlowSteps(nextView.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "gpu",
      "runUp",
      "mcpPlaywright"
    ])
    expect(context.setMessage).toHaveBeenCalledWith(null)
  })

  it("enters the settings wizard when explicitly requested from the repo URL step", () => {
    const { setCreateViewSpy } = submitCreateBuffer(
      "https://github.com/org/repo/tree/feature-x",
      { quickCreate: false }
    )

    expect(submitCreateInputsMock).not.toHaveBeenCalled()
    expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toMatchObject({
      step: 1,
      values: {
        outDir: "/home/dev/.docker-git/org/repo",
        repoRef: "feature-x",
        repoUrl: "https://github.com/org/repo/tree/feature-x"
      }
    })
  })

  it("moves between settings with arrows and clears the uncommitted buffer", () => {
    expectCreateArrowHandling("ArrowDown", (view) => view.step + 1)
  })

  it("wraps settings selection upward with ArrowUp and clears the uncommitted buffer", () => {
    expectCreateArrowHandling("ArrowUp", (view) => resolveCreateFlowSteps(view.values).length - 1)
  })

  it("fills discrete settings buffers with side arrows without applying values", () => {
    const cases: ReadonlyArray<{
      readonly expectedBuffer: string
      readonly key: "ArrowLeft" | "ArrowRight"
      readonly stepName: CreateStep
    }> = [
      { expectedBuffer: "none", key: "ArrowLeft", stepName: "gpu" },
      { expectedBuffer: "all", key: "ArrowRight", stepName: "gpu" },
      { expectedBuffer: "n", key: "ArrowLeft", stepName: "runUp" },
      { expectedBuffer: "y", key: "ArrowRight", stepName: "runUp" },
      { expectedBuffer: "n", key: "ArrowLeft", stepName: "mcpPlaywright" },
      { expectedBuffer: "y", key: "ArrowRight", stepName: "mcpPlaywright" },
      { expectedBuffer: "n", key: "ArrowLeft", stepName: "force" },
      { expectedBuffer: "y", key: "ArrowRight", stepName: "force" }
    ]

    for (const { expectedBuffer, key, stepName } of cases) {
      submitCreateInputsMock.mockReset()
      expectCreateSideArrowBufferHandling(key, stepName, expectedBuffer)
    }
  })

  it("applies a side-arrow choice only after Enter", () => {
    const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
    const createView = createSettingsFlowViewAtStep("gpu", "typed")
    const arrowEvent = createKeyEvent("ArrowRight")

    const arrowHandled = handleCreateKey(arrowEvent, {
      context,
      controllerCwd: "/workspace",
      createView,
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })
    const arrowView = requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])
    const enterEvent = createKeyEvent("Enter")

    const enterHandled = handleCreateKey(enterEvent, {
      context,
      controllerCwd: "/workspace",
      createView: arrowView,
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })
    const enteredView = requireCreateViewValue(setCreateViewSpy.mock.calls[1]?.[0])

    expect(arrowHandled).toBe(true)
    expect(arrowView.values.gpu).toBeUndefined()
    expect(enterHandled).toBe(true)
    expect(enteredView.values.gpu).toBe("all")
    expect(enteredView.step).toBe(resolveCreateDisplaySteps().indexOf("gpu"))
    expect(enteredView.buffer).toBe("")
    expect(submitCreateInputsMock).not.toHaveBeenCalled()
  })

  it("keeps an applied settings row selected and visible instead of submitting", () => {
    const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
    const createView: CreateFlowView = {
      ...createSettingsFlowViewAtStep("force", "y"),
      values: {
        ...createSettingsFlowView().values,
        cpuLimit: "40%",
        enableMcpPlaywright: true,
        gpu: "all",
        ramLimit: "8g",
        runUp: false
      }
    }
    const event = createKeyEvent("Enter")

    const handled = handleCreateKey(event, {
      context,
      controllerCwd: "/workspace",
      createView,
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })
    const enteredView = requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])

    expect(handled).toBe(true)
    expect(enteredView.values.force).toBe(true)
    expect(enteredView.step).toBe(resolveCreateDisplaySteps().indexOf("force"))
    expect(enteredView.buffer).toBe("")
    expect(submitCreateInputsMock).not.toHaveBeenCalled()
  })

  it("navigates to the next visible row after applying a settings row", () => {
    const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
    const createView = createSettingsFlowViewAtStep("mcpPlaywright", "y")
    const enterEvent = createKeyEvent("Enter")

    handleCreateKey(enterEvent, {
      context,
      controllerCwd: "/workspace",
      createView,
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })
    const enteredView = requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])
    const downEvent = createKeyEvent("ArrowDown")

    const handled = handleCreateKey(downEvent, {
      context,
      controllerCwd: "/workspace",
      createView: enteredView,
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })
    const downView = requireCreateViewValue(setCreateViewSpy.mock.calls[1]?.[0])

    expect(handled).toBe(true)
    expect(downView.step).toBe(resolveCreateDisplaySteps().indexOf("force"))
    expect(downView.values.enableMcpPlaywright).toBe(true)
    expect(downView.buffer).toBe("")
  })

  it("clears an unconfirmed preview when navigating away from a settings row", () => {
    const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
    const createView = createSettingsFlowViewAtStep("mcpPlaywright", "y")
    const event = createKeyEvent("ArrowDown")

    const handled = handleCreateKey(event, {
      context,
      controllerCwd: "/workspace",
      createView,
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })
    const nextView = requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])

    expect(handled).toBe(true)
    expect(nextView.step).toBe(resolveCreateDisplaySteps().indexOf("force"))
    expect(nextView.values.enableMcpPlaywright).toBeUndefined()
    expect(nextView.buffer).toBe("")
  })

  it("submits settings Done with a valid active preview applied first", () => {
    const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()

    submitCreateView({
      context,
      controllerCwd: "/workspace",
      createView: createSettingsFlowViewAtStep("mcpPlaywright", "y"),
      projectsRoot: "/home/dev/.docker-git",
      quickCreate: false,
      setCreateView
    })

    expect(submitCreateInputsMock).toHaveBeenCalledTimes(1)
    expect(requireSubmittedCreateInputs().enableMcpPlaywright).toBe(true)
    expectCreateViewReset(setCreateViewSpy)
  })

  it("shows a parse error when settings Done has an invalid active preview", () => {
    const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()

    submitCreateView({
      context,
      controllerCwd: "/workspace",
      createView: createSettingsFlowViewAtStep("gpu", "bogus"),
      projectsRoot: "/home/dev/.docker-git",
      quickCreate: false,
      setCreateView
    })

    expect(submitCreateInputsMock).not.toHaveBeenCalled()
    expect(setCreateViewSpy).not.toHaveBeenCalled()
    expect(context.setMessage).toHaveBeenCalledWith("Invalid option create: gpu must be one of: none, all, yes, no")
  })

  it("ignores settings arrows before the Settings flow starts", () => {
    const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
    const event = createKeyEvent("ArrowDown")

    const handled = handleCreateKey(event, {
      context,
      controllerCwd: "/workspace",
      createView: createInitialFlowView("https://github.com/org/repo"),
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })

    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(setCreateViewSpy).not.toHaveBeenCalled()
    expect(context.setMessage).not.toHaveBeenCalled()
  })

  it("ignores side arrows before Settings and on free-text settings", () => {
    const keys: ReadonlyArray<"ArrowLeft" | "ArrowRight"> = ["ArrowLeft", "ArrowRight"]
    const views: ReadonlyArray<CreateFlowView> = [
      createInitialFlowView("https://github.com/org/repo"),
      createSettingsFlowViewAtStep("cpuLimit"),
      createSettingsFlowViewAtStep("ramLimit")
    ]

    for (const key of keys) {
      for (const createView of views) {
        const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
        const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
        const event = createKeyEvent(key)

        const handled = handleCreateKey(event, {
          context,
          controllerCwd: "/workspace",
          createView,
          projectsRoot: "/home/dev/.docker-git",
          setCreateView
        })

        expect(handled).toBe(false)
        expect(event.preventDefault).not.toHaveBeenCalled()
        expect(setCreateViewSpy).not.toHaveBeenCalled()
        expect(context.setMessage).not.toHaveBeenCalled()
      }
    }
  })

  it("shows a parse error instead of submitting on invalid inline flags", () => {
    const { context, setCreateViewSpy } = submitCreateBuffer("https://github.com/org/repo --bogus")

    expect(setCreateViewSpy).not.toHaveBeenCalled()
    expect(context.setMessage).toHaveBeenCalledWith("Missing value for option: --bogus")
  })

  it("submits a quick create clone from the Create menu", () => {
    const { setCreateViewSpy } = submitCreateBuffer(
      "https://github.com/octocat/Hello-World/tree/feature-x",
      { quickCreate: true }
    )

    expect(submitCreateInputsMock).toHaveBeenCalledTimes(1)
    expectQuickCreateInputs({
      outDir: "/home/dev/.docker-git/octocat/hello-world",
      repoRef: "feature-x",
      repoUrl: "https://github.com/octocat/Hello-World/tree/feature-x"
    })
    expectCreateViewReset(setCreateViewSpy)
  })

  it("preserves quick create repo url to out dir invariants for generated GitHub repos", () => {
    fc.assert(
      fc.property(repositoryCreateInputArbitrary, ({ expectedRepoRef, repoUrl }) => {
        submitCreateInputsMock.mockReset()
        const { setCreateViewSpy } = submitCreateBuffer(repoUrl, { quickCreate: true })

        expect(submitCreateInputsMock).toHaveBeenCalledTimes(1)
        expectQuickCreateInputs({
          outDir: expectedOutDirForRepoUrl(repoUrl),
          repoRef: expectedRepoRef,
          repoUrl
        })
        expectCreateViewReset(setCreateViewSpy)
      }),
      { numRuns: 50 }
    )
  })
})
