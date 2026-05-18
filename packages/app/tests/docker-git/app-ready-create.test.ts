import * as fc from "fast-check"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { submitCreateInputs } from "../../src/web/actions-projects.js"
import { handleCreateKey, setCreateBuffer, submitCreateView } from "../../src/web/app-ready-create.js"
import {
  type CreateFlowView,
  createInitialFlowView,
  createKeyEvent,
  createSetCreateViewSpy,
  createSubmitCreateBuffer,
  expectCreateViewReset,
  expectedOutDirForRepoUrl,
  expectEmptyRepoInlineError,
  expectQuickCreateInputs,
  repositoryCreateInputArbitrary,
  requireCreateViewValue,
  resolveCreateFlowSteps,
  validGithubStatus
} from "./app-ready-create-fixture.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"

const mocks = vi.hoisted(() => ({
  submitCreateInputsMock: vi.fn<typeof submitCreateInputs>()
}))

vi.mock("../../src/web/actions-projects.js", () => ({
  submitCreateInputs: mocks.submitCreateInputsMock
}))

const submitCreateInputsMock = mocks.submitCreateInputsMock
const submitCreateBuffer = createSubmitCreateBuffer(submitCreateView)

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

  it("shows an inline error for empty repo URL quick create without submitting", () => {
    expectEmptyRepoInlineError(submitCreateView, submitCreateInputsMock, true)
  })

  it("shows an inline error for empty repo URL settings without entering Settings", () => {
    expectEmptyRepoInlineError(submitCreateView, submitCreateInputsMock, false)
  })

  it("shows an inline error for empty repo URL Enter without advancing", () => {
    expectEmptyRepoInlineError(submitCreateView, submitCreateInputsMock)
  })

  it("shows an inline error for empty repo URL keyboard submits", () => {
    for (const shiftKey of [false, true]) {
      const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
      const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
      const createView = createInitialFlowView("")
      const event = createKeyEvent("Enter", shiftKey)

      const handled = handleCreateKey(event, {
        context,
        controllerCwd: "/workspace",
        createView,
        projectsRoot: "/home/dev/.docker-git",
        setCreateView
      })

      expect(handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(submitCreateInputsMock).not.toHaveBeenCalled()
      expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toEqual({
        ...createView,
        inputError: "Insert URL first"
      })
      expect(context.setMessage).not.toHaveBeenCalled()
    }
  })

  it("validates empty repo URL before GitHub auth", () => {
    const { context } = makeBrowserActionContext()
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
    const createView = createInitialFlowView("")

    submitCreateView({
      context,
      controllerCwd: "/workspace",
      createView,
      projectsRoot: "/home/dev/.docker-git",
      quickCreate: true,
      setCreateView
    })

    expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toEqual({
      ...createView,
      inputError: "Insert URL first"
    })
    expect(context.setMessage).not.toHaveBeenCalled()
    expect(context.setActiveScreen).not.toHaveBeenCalled()
  })

  it("clears the inline repo URL error after editing the buffer", () => {
    const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()
    const createView: CreateFlowView = {
      ...createInitialFlowView(""),
      inputError: "Insert URL first"
    }

    setCreateBuffer(createView, setCreateView, "https://github.com/org/repo")

    expect(requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])).toEqual({
      ...createView,
      buffer: "https://github.com/org/repo",
      inputError: null
    })
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
    expectQuickCreateInputs(submitCreateInputsMock, {
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
        expectQuickCreateInputs(submitCreateInputsMock, {
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
