import { describe, expect, it } from "vitest"

import {
  advanceCreateFlow,
  createInitialFlowView,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"

const expectContinueResult = (
  next: ReturnType<typeof advanceCreateFlow>
) => {
  expect(next?._tag).toBe("Continue")
  if (next === null || next._tag !== "Continue") {
    throw new TypeError("expected continue create flow result")
  }
  return next.view
}

const expectCompleteResult = (
  next: ReturnType<typeof advanceCreateFlow>
) => {
  expect(next?._tag).toBe("Complete")
  if (next === null || next._tag !== "Complete") {
    throw new TypeError("expected complete create flow result")
  }
  return next.inputs
}

describe("menu-create-shared", () => {
  const cwd = process.cwd()
  const defaultRoot = `${process.env["HOME"] ?? cwd}/.docker-git/org/repo`
  const expectRepoFields = (
    values: {
      readonly outDir?: string | undefined
      readonly repoRef?: string | undefined
      readonly repoUrl?: string | undefined
    }
  ) => {
    expect(values.repoUrl).toBe("https://github.com/org/repo/tree/feature-x")
    expect(values.repoRef).toBe("feature-x")
    expect(values.outDir).toBe(defaultRoot)
  }

  it("advances from repo URL into the wizard by default", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))

    expect(view.step).toBe(1)
    expectRepoFields(view.values)
    expect(view.values.runUp).toBeUndefined()
    expect(resolveCreateFlowSteps(view.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "runUp",
      "mcpPlaywright",
      "force"
    ])
  })

  it("quick-creates from repo URL only when requested explicitly", () => {
    const inputs = expectCompleteResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x"),
      { quickCreate: true }
    ))

    expectRepoFields(inputs)
    expect(inputs.runUp).toBe(true)
  })

  it("prefills create values from inline CLI flags on the repo step", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x --force --mcp-playwright --no-up")
    ))

    expectRepoFields(view.values)
    expect(view.values.force).toBe(true)
    expect(view.values.enableMcpPlaywright).toBe(true)
    expect(view.values.runUp).toBe(false)
    expect(resolveCreateFlowSteps(view.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit"
    ])
  })

  it("completes immediately when every remaining prompt was passed inline", () => {
    const inputs = expectCompleteResult(advanceCreateFlow(
      cwd,
      createInitialFlowView(
        "https://github.com/org/repo/tree/feature-x --cpu 25% --ram 4g --no-up --mcp-playwright --force"
      )
    ))

    expectRepoFields(inputs)
    expect(inputs.cpuLimit).toBe("25%")
    expect(inputs.ramLimit).toBe("4g")
    expect(inputs.runUp).toBe(false)
    expect(inputs.enableMcpPlaywright).toBe(true)
    expect(inputs.force).toBe(true)
  })

  it("returns a parse error for invalid inline flags", () => {
    const next = advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo --bogus")
    )

    expect(next?._tag).toBe("Error")
    if (next === null || next._tag !== "Error") {
      return
    }

    expect(next.error).toEqual({
      _tag: "MissingOptionValue",
      option: "--bogus"
    })
  })

  it("uses server-provided projectsRoot in browser mode", () => {
    const view = expectContinueResult(advanceCreateFlow(
      {
        cwd: "/repo/packages/api",
        projectsRoot: "/home/dev/.docker-git"
      },
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))

    expect(view.values.outDir).toBe("/home/dev/.docker-git/org/repo")
  })
})
