import * as fc from "fast-check"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { submitCreateInputs } from "../../src/web/actions-projects.js"
import { handleCreateKey, setCreateBuffer, submitCreateView } from "../../src/web/app-ready-create.js"
import {
  type CreateFlowView,
  createInitialFlowView,
  createSetCreateViewSpy,
  createSubmitCreateBuffer,
  expectCreateViewInputError,
  expectCreateViewReset,
  expectEmptyRepoInlineError,
  expectEmptyRepoKeyboardInlineError,
  expectQuickCreateInputs,
  requireCreateViewValue,
  resolveCreateFlowSteps,
  runSubmitCreateView
} from "./app-ready-create-fixture.js"
import { expectedOutDirForRepoUrl, repositoryCreateInputArbitrary } from "./create-flow-test-helpers.js"

const submitCreateInputsMock = vi.hoisted(() => vi.fn<typeof submitCreateInputs>())

vi.mock("../../src/web/actions-projects.js", () => ({
  submitCreateInputs: submitCreateInputsMock
}))

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
      mode: "display",
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
      { mode: "advance" }
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
    expectEmptyRepoInlineError(submitCreateView, submitCreateInputsMock, "quick-create")
  })

  it("shows an inline error for empty repo URL settings without entering Settings", () => {
    expectEmptyRepoInlineError(submitCreateView, submitCreateInputsMock, "advance")
  })

  it("shows an inline error for empty repo URL Enter without advancing", () => {
    expectEmptyRepoInlineError(submitCreateView, submitCreateInputsMock)
  })

  it("shows an inline error for empty repo URL keyboard submits", () => {
    for (const shiftKey of [false, true]) {
      expectEmptyRepoKeyboardInlineError(handleCreateKey, submitCreateInputsMock, shiftKey)
    }
  })

  it("validates empty repo URL before GitHub auth", () => {
    const createView = createInitialFlowView("")
    const { context, setCreateViewSpy } = runSubmitCreateView(submitCreateView, createView, {
      contextOverrides: {},
      mode: "quick-create"
    })

    expectCreateViewInputError(setCreateViewSpy, createView)
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
      { mode: "quick-create" }
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
        const { setCreateViewSpy } = submitCreateBuffer(repoUrl, { mode: "quick-create" })

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
