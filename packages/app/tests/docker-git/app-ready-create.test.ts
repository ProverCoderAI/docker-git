import type { Dispatch, SetStateAction } from "react"
import { describe, expect, it, vi } from "vitest"

import { createInitialFlowView, type CreateFlowView, resolveCreateFlowSteps } from "../../src/docker-git/menu-create-shared.js"
import type { BrowserActionContext } from "../../src/web/actions.js"
import { submitCreateView } from "../../src/web/app-ready-create.js"

const createBrowserActionContext = (): BrowserActionContext => ({
  githubStatus: {
    tokens: [{ status: "valid" }]
  } as never,
  setActionPrompt: vi.fn(),
  setActiveScreen: vi.fn(),
  setMessage: vi.fn(),
  setSelectedMenuIndex: vi.fn()
} as unknown as BrowserActionContext)

describe("app-ready-create", () => {
  it("advances to the next create field on Enter for a repo URL", () => {
    const context = createBrowserActionContext()
    const setCreateViewSpy = vi.fn()
    const setCreateView = setCreateViewSpy as unknown as Dispatch<SetStateAction<CreateFlowView>>

    submitCreateView({
      context,
      controllerCwd: "/workspace",
      createView: createInitialFlowView("https://github.com/org/repo/tree/feature-x --force"),
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })

    expect(setCreateViewSpy).toHaveBeenCalledTimes(1)
    const nextView = setCreateViewSpy.mock.calls[0]?.[0]
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
      "runUp",
      "mcpPlaywright"
    ])
    expect(context.setMessage).toHaveBeenCalledWith(null)
  })

  it("shows a parse error instead of submitting on invalid inline flags", () => {
    const context = createBrowserActionContext()
    const setCreateViewSpy = vi.fn()
    const setCreateView = setCreateViewSpy as unknown as Dispatch<SetStateAction<CreateFlowView>>

    submitCreateView({
      context,
      controllerCwd: "/workspace",
      createView: createInitialFlowView("https://github.com/org/repo --bogus"),
      projectsRoot: "/home/dev/.docker-git",
      setCreateView
    })

    expect(setCreateViewSpy).not.toHaveBeenCalled()
    expect(context.setMessage).toHaveBeenCalledWith("Missing value for option: --bogus")
  })
})
