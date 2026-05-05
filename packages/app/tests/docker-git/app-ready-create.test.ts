import type { Dispatch, SetStateAction } from "react"
import { describe, expect, it } from "vitest"

import {
  type CreateFlowView,
  createInitialFlowView,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"
import { submitCreateView } from "../../src/web/app-ready-create.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"

const createBrowserActionContext = () =>
  makeBrowserActionContext({
    githubStatus: {
      summary: "valid",
      tokens: [{ key: "default", label: "Default", login: null, status: "valid" }]
    }
  }).context

const createSetCreateViewSpy = () => {
  let callCount = 0
  let currentView: CreateFlowView | undefined
  const setCreateView: Dispatch<SetStateAction<CreateFlowView>> = (value) => {
    callCount += 1
    currentView = typeof value === "function"
      ? value(currentView ?? createInitialFlowView())
      : value
  }
  return {
    callCount: () => callCount,
    setCreateView,
    view: () => currentView
  }
}

const submitTestCreateView = (buffer: string) => {
  const context = createBrowserActionContext()
  const setCreateViewSpy = createSetCreateViewSpy()
  submitCreateView({
    context,
    controllerCwd: "/workspace",
    createView: createInitialFlowView(buffer),
    projectsRoot: "/home/dev/.docker-git",
    setCreateView: setCreateViewSpy.setCreateView
  })
  return { context, setCreateViewSpy }
}

describe("app-ready-create", () => {
  it("advances to the next create field on Enter for a repo URL", () => {
    const { context, setCreateViewSpy } = submitTestCreateView("https://github.com/org/repo/tree/feature-x --force")

    expect(setCreateViewSpy.callCount()).toBe(1)
    const nextView = setCreateViewSpy.view()
    expect(nextView).toBeDefined()
    if (nextView === undefined) {
      throw new Error("Expected create view to advance")
    }
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
    const { context, setCreateViewSpy } = submitTestCreateView("https://github.com/org/repo --bogus")

    expect(setCreateViewSpy.callCount()).toBe(0)
    expect(context.setMessage).toHaveBeenCalledWith("Missing value for option: --bogus")
  })
})
