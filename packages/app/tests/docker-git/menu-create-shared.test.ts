import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  advanceCreateFlow,
  createInitialFlowView,
  moveCreateSettingsStep,
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

const expectedSettingsStep = (
  step: number,
  direction: "up" | "down",
  lastStep: number
): number => {
  if (direction === "up") {
    return step === 1 ? lastStep : step - 1
  }
  return step === lastStep ? 1 : step + 1
}

describe("menu-create-shared", () => {
  const cwd = process.cwd()
  const defaultRoot = `${process.env["HOME"] ?? cwd}/.docker-git/org/repo`
  const settingsDirectionArbitrary: fc.Arbitrary<"up" | "down"> = fc.constantFrom("up", "down")

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

  it("moves between remaining settings rows and clears the input buffer", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))
    const editingView = { ...view, buffer: "stale" }
    const lastStep = resolveCreateFlowSteps(view.values).length - 1

    const downView = moveCreateSettingsStep(editingView, "down")

    expect(downView).toEqual({
      ...view,
      step: 2,
      buffer: ""
    })

    const wrappedView = moveCreateSettingsStep(view, "up")

    expect(wrappedView).toEqual({
      ...view,
      step: lastStep,
      buffer: ""
    })
  })

  it("preserves settings navigation wraparound and buffer invariants", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))
    const lastStep = resolveCreateFlowSteps(view.values).length - 1

    fc.assert(
      fc.property(fc.integer({ min: 1, max: lastStep }), settingsDirectionArbitrary, (step, direction) => {
        const next = moveCreateSettingsStep({ ...view, step, buffer: "draft" }, direction)

        expect(next).not.toBeNull()
        expect(next?.step).toBe(expectedSettingsStep(step, direction, lastStep))
        expect(next?.buffer).toBe("")
        expect(next?.values).toEqual(view.values)
      })
    )
  })

  it("does not navigate settings from the repo URL step", () => {
    expect(moveCreateSettingsStep(createInitialFlowView("https://github.com/org/repo"), "down")).toBeNull()
  })

  it("rejects settings navigation for every repo URL step buffer", () => {
    fc.assert(
      fc.property(fc.string(), (buffer) => {
        expect(moveCreateSettingsStep(createInitialFlowView(buffer), "down")).toBeNull()
        expect(moveCreateSettingsStep(createInitialFlowView(buffer), "up")).toBeNull()
      })
    )
  })

  it("continues after applying a navigated setting while earlier settings remain unresolved", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))
    const forceView = moveCreateSettingsStep(view, "up")

    if (forceView === null) {
      throw new TypeError("expected settings navigation result")
    }

    const next = expectContinueResult(advanceCreateFlow(
      cwd,
      {
        ...forceView,
        buffer: "y"
      }
    ))

    expect(next.values.force).toBe(true)
    expect(next.step).toBe(resolveCreateFlowSteps(next.values).length - 1)
    expect(resolveCreateFlowSteps(next.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "gpu",
      "runUp",
      "mcpPlaywright"
    ])
  })
})
