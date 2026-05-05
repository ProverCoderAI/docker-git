import type { Dispatch, SetStateAction } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  type CreateFlowView,
  createInitialFlowView,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"
import { submitCreateView } from "../../src/web/app-ready-create.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"

const validGithubStatus = {
  summary: "valid",
  tokens: [{ key: "default", label: "default", login: "octocat", status: "valid" }]
} as const

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

const submitCreateBuffer = (buffer: string) => {
  const { context } = makeBrowserActionContext({ githubStatus: validGithubStatus })
  const { setCreateView, spy: setCreateViewSpy } = createSetCreateViewSpy()

  submitCreateView({
    context,
    controllerCwd: "/workspace",
    createView: createInitialFlowView(buffer),
    projectsRoot: "/home/dev/.docker-git",
    setCreateView
  })

  return { context, setCreateViewSpy }
}

describe("app-ready-create", () => {
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
      "runUp",
      "mcpPlaywright"
    ])
    expect(context.setMessage).toHaveBeenCalledWith(null)
  })

  it("shows a parse error instead of submitting on invalid inline flags", () => {
    const { context, setCreateViewSpy } = submitCreateBuffer("https://github.com/org/repo --bogus")

    expect(setCreateViewSpy).not.toHaveBeenCalled()
    expect(context.setMessage).toHaveBeenCalledWith("Missing value for option: --bogus")
  })
})
