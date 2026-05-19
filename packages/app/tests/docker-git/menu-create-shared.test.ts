import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  advanceCreateFlow,
  createDisplayFlowView,
  createInitialFlowView,
  moveCreateSettingsStep,
  resolveCreateDisplaySteps,
  resolveCreateFlowSteps,
  resolveCreateSettingsChoiceBuffer
} from "../../src/docker-git/menu-create-shared.js"
import {
  createFeatureRepoDisplaySettingsView,
  createFeatureRepoSettingsView,
  createFlowViewAtStep,
  expectCreateCompleteInputs,
  expectCreateContinueView,
  expectCreateNavigationResult,
  expectedWrappedCreateNavigationStep,
  featureCreateRepoUrl
} from "./create-flow-test-helpers.js"

const expectFeatureRepoDefaults = (
  value: {
    readonly outDir?: string
    readonly repoRef?: string
    readonly repoUrl?: string
  },
  defaultRoot: string
) => {
  expect(value.repoUrl).toBe(featureCreateRepoUrl)
  expect(value.repoRef).toBe("feature-x")
  expect(value.outDir).toBe(defaultRoot)
}

describe("menu-create-shared", () => {
  const cwd = process.cwd()
  const defaultRoot = `${process.env["HOME"] ?? cwd}/.docker-git/org/repo`
  const settingsDirectionArbitrary: fc.Arbitrary<"up" | "down"> = fc.constantFrom("up", "down")

  it("advances from repo URL into the wizard by default", () => {
    const view = expectCreateContinueView(advanceCreateFlow(
      cwd,
      createInitialFlowView(featureCreateRepoUrl)
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
    const inputs = expectCreateCompleteInputs(advanceCreateFlow(
      cwd,
      createInitialFlowView(featureCreateRepoUrl),
      { quickCreate: true }
    ))

    expectFeatureRepoDefaults(inputs, defaultRoot)
    expect(inputs.runUp).toBe(true)
  })

  it("prefills create values from inline CLI flags on the repo step", () => {
    const view = expectCreateContinueView(advanceCreateFlow(
      cwd,
      createInitialFlowView(`${featureCreateRepoUrl} --force --mcp-playwright --no-up`)
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
    const inputs = expectCreateCompleteInputs(advanceCreateFlow(
      cwd,
      createInitialFlowView(
        `${featureCreateRepoUrl} --cpu 25% --ram 4g --gpu all --no-up --mcp-playwright --force`
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
    const view = expectCreateContinueView(advanceCreateFlow(
      {
        cwd: "/repo/packages/api",
        projectsRoot: "/home/dev/.docker-git"
      },
      createInitialFlowView(featureCreateRepoUrl)
    ))

    expect(view.values.outDir).toBe("/home/dev/.docker-git/org/repo")
  })

  it("moves between remaining settings rows and clears the input buffer", () => {
    const view = createFeatureRepoSettingsView(cwd)
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
    const view = createFeatureRepoSettingsView(cwd)
    const lastStep = resolveCreateFlowSteps(view.values).length - 1

    fc.assert(
      fc.property(fc.integer({ min: 1, max: lastStep }), settingsDirectionArbitrary, (step, direction) => {
        const next = moveCreateSettingsStep({ ...view, step, buffer: "draft" }, direction)

        expectCreateNavigationResult(next, expectedWrappedCreateNavigationStep(step, direction, lastStep), view.values)
      })
    )
  })

  it("maps create-mode steps to the matching display row when opening browser Settings", () => {
    const createView = {
      ...createFeatureRepoSettingsView(cwd),
      step: 1,
      values: {
        ...createFeatureRepoSettingsView(cwd).values,
        cpuLimit: "40%"
      }
    }
    const displayView = createDisplayFlowView(createView)

    expect(resolveCreateFlowSteps(createView.values)[createView.step]).toBe("ramLimit")
    expect(resolveCreateDisplaySteps()[displayView.step]).toBe("ramLimit")
    expect(displayView.buffer).toBe(createView.buffer)
    expect(displayView.values).toEqual(createView.values)
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

  it("resolves horizontal choices to buffer tokens for discrete settings rows", () => {
    const view = createFeatureRepoDisplaySettingsView(cwd)

    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "gpu"), "left")).toBe("none")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "gpu"), "right")).toBe("all")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "runUp"), "left")).toBe("n")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "runUp"), "right")).toBe("y")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "mcpPlaywright"), "left")).toBe("n")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "mcpPlaywright"), "right")).toBe("y")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "force"), "left")).toBe("n")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "force"), "right")).toBe("y")
  })

  it("does not resolve horizontal choices for free-text rows or unknown steps", () => {
    const view = createFeatureRepoDisplaySettingsView(cwd)
    const unknownStepView = {
      ...view,
      step: resolveCreateDisplaySteps().length + 1,
      buffer: "draft"
    }

    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "cpuLimit"), "left")).toBeNull()
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "ramLimit"), "right")).toBeNull()
    expect(resolveCreateSettingsChoiceBuffer(unknownStepView, "left")).toBeNull()
  })

  it("continues after applying a navigated setting while earlier settings remain unresolved", () => {
    const view = createFeatureRepoSettingsView(cwd)
    const forceView = moveCreateSettingsStep(view, "up")

    if (forceView === null) {
      throw new TypeError("expected settings navigation result")
    }

    const next = expectCreateContinueView(advanceCreateFlow(
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
