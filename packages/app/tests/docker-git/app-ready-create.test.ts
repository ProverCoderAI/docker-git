import * as fc from "fast-check"
import type { Dispatch, SetStateAction } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { deriveRepoPathParts, resolveRepoInput } from "../../src/docker-git/frontend-lib/core/domain.js"
import {
  type CreateFlowView,
  createInitialFlowView,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"
import type { CreateInputs } from "../../src/docker-git/menu-types.js"
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
