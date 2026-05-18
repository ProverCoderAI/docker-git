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

const expectFeatureRepoDefaults = (
  value: {
    readonly outDir?: string
    readonly repoRef?: string
    readonly repoUrl?: string
  },
  defaultRoot: string
) => {
  expect(value.repoUrl).toBe("https://github.com/org/repo/tree/feature-x")
  expect(value.repoRef).toBe("feature-x")
  expect(value.outDir).toBe(defaultRoot)
}

describe("menu-create-shared", () => {
  const cwd = process.cwd()
  const defaultRoot = `${process.env["HOME"] ?? cwd}/.docker-git/org/repo`

  it("advances from repo URL into the wizard by default", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))

    expect(view.step).toBe(1)
    expectFeatureRepoDefaults(view.values, defaultRoot)
    expect(view.values.runUp).toBeUndefined()
    expect(resolveCreateFlowSteps(view.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "gpu",
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

    expectFeatureRepoDefaults(inputs, defaultRoot)
    expect(inputs.runUp).toBe(true)
  })

  it("prefills create values from inline CLI flags on the repo step", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x --force --mcp-playwright --no-up")
    ))

    expectFeatureRepoDefaults(view.values, defaultRoot)
    expect(view.values.force).toBe(true)
    expect(view.values.enableMcpPlaywright).toBe(true)
    expect(view.values.runUp).toBe(false)
    expect(resolveCreateFlowSteps(view.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "gpu"
    ])
  })

  it("completes immediately when every remaining prompt was passed inline", () => {
    const inputs = expectCompleteResult(advanceCreateFlow(
      cwd,
      createInitialFlowView(
        "https://github.com/org/repo/tree/feature-x --cpu 25% --ram 4g --gpu all --no-up --mcp-playwright --force"
      )
    ))

    expectFeatureRepoDefaults(inputs, defaultRoot)
    expect(inputs.cpuLimit).toBe("25%")
    expect(inputs.ramLimit).toBe("4g")
    expect(inputs.gpu).toBe("all")
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
