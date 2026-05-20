import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  advanceCreateDisplaySettingsStep,
  applyCreateDisplaySettingsStep,
  completeCreateDisplaySettingsFlow,
  type DisplayModeFlowView,
  moveCreateDisplaySettingsStep,
  renderCreateStepLabelWithBufferPreview,
  resolveCreateDisplaySteps,
  resolveCreateInputs,
  resolveCreateSettingsChoiceBuffer
} from "../../src/docker-git/menu-create-shared.js"
import type { CreateStep } from "../../src/docker-git/menu-types.js"
import {
  createFeatureRepoDisplaySettingsView,
  createFlowViewAtStep,
  expectCreateCompleteInputs,
  expectCreateContinueView,
  expectCreateNavigationResult,
  expectedWrappedCreateNavigationStep
} from "./create-flow-test-helpers.js"

const expectDisplayModeView = (view: ReturnType<typeof expectCreateContinueView>): DisplayModeFlowView => {
  expect(view.mode).toBe("display")
  if (view.mode !== "display") {
    throw new TypeError("expected display mode CreateFlowView")
  }
  return view
}

describe("menu-create-shared display settings", () => {
  const cwd = process.cwd()
  const isDisplaySettingStep = (step: CreateStep): step is Exclude<CreateStep, "repoUrl"> => step !== "repoUrl"
  const displaySettingSteps = resolveCreateDisplaySteps().filter(isDisplaySettingStep)
  const discreteDisplaySteps: ReadonlyArray<"gpu" | "runUp" | "mcpPlaywright" | "force"> = [
    "gpu",
    "runUp",
    "mcpPlaywright",
    "force"
  ]
  const validBufferByStep: Record<CreateStep, string> = {
    cpuLimit: "45%",
    force: "y",
    gpu: "all",
    mcpPlaywright: "y",
    outDir: "/home/dev/.docker-git/org/repo-preview",
    ramLimit: "8g",
    repoRef: "main",
    repoUrl: "https://github.com/org/repo",
    runUp: "n"
  }

  it("keeps every browser display row after settings are applied", () => {
    const appliedValues = {
      cpuLimit: "40%",
      enableMcpPlaywright: true,
      force: true,
      gpu: "all",
      ramLimit: "8g",
      runUp: false
    } satisfies Partial<ReturnType<typeof resolveCreateInputs>>

    expect(resolveCreateDisplaySteps(appliedValues)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "gpu",
      "runUp",
      "mcpPlaywright",
      "force"
    ])
  })

  it("applies a browser display setting in place", () => {
    const mcpView = createFlowViewAtStep(createFeatureRepoDisplaySettingsView(cwd), "mcpPlaywright")
    const next = expectCreateContinueView(applyCreateDisplaySettingsStep(cwd, { ...mcpView, buffer: "y" }))

    expect(next.step).toBe(mcpView.step)
    expect(next.buffer).toBe("")
    expect(next.values.enableMcpPlaywright).toBe(true)
    expect(resolveCreateDisplaySteps()[next.step]).toBe("mcpPlaywright")
  })

  it("applies a browser display setting and advances to the next row", () => {
    const next = expectDisplayModeView(expectCreateContinueView(advanceCreateDisplaySettingsStep(
      cwd,
      { ...createFlowViewAtStep(createFeatureRepoDisplaySettingsView(cwd), "mcpPlaywright"), buffer: "y" }
    )))

    expect(next.step).toBe(resolveCreateDisplaySteps().indexOf("force"))
    expect(next.buffer).toBe("")
    expect(next.values.enableMcpPlaywright).toBe(true)
  })

  it("preserves an existing setting value on empty Enter and wraps after the last row", () => {
    const view = createFlowViewAtStep(createFeatureRepoDisplaySettingsView(cwd), "force", "")
    const next = expectDisplayModeView(expectCreateContinueView(advanceCreateDisplaySettingsStep(
      cwd,
      {
        ...view,
        values: {
          ...view.values,
          force: true
        }
      }
    )))

    expect(next.step).toBe(resolveCreateDisplaySteps().indexOf("cpuLimit"))
    expect(next.buffer).toBe("")
    expect(next.values.force).toBe(true)
  })

  it("navigates browser display settings without skipping applied rows", () => {
    const view = createFeatureRepoDisplaySettingsView(cwd)
    const applied = expectDisplayModeView(expectCreateContinueView(applyCreateDisplaySettingsStep(
      cwd,
      { ...createFlowViewAtStep(view, "mcpPlaywright"), buffer: "y" }
    )))
    const down = moveCreateDisplaySettingsStep(applied, "down")
    const up = moveCreateDisplaySettingsStep(applied, "up")

    expect(down?.step).toBe(resolveCreateDisplaySteps().indexOf("force"))
    expect(up?.step).toBe(resolveCreateDisplaySteps().indexOf("runUp"))
    expect(down?.buffer).toBe("")
    expect(up?.values.enableMcpPlaywright).toBe(true)
  })

  it("resolves horizontal choices against applied browser display rows", () => {
    const applied = expectDisplayModeView(expectCreateContinueView(applyCreateDisplaySettingsStep(
      cwd,
      { ...createFlowViewAtStep(createFeatureRepoDisplaySettingsView(cwd), "mcpPlaywright"), buffer: "y" }
    )))

    expect(resolveCreateSettingsChoiceBuffer(applied, "left")).toBe("n")
    expect(resolveCreateSettingsChoiceBuffer(applied, "right")).toBe("y")
  })

  it("completes browser display settings with a valid active buffer", () => {
    const complete = expectCreateCompleteInputs(completeCreateDisplaySettingsFlow(
      cwd,
      { ...createFlowViewAtStep(createFeatureRepoDisplaySettingsView(cwd), "mcpPlaywright"), buffer: "y" }
    ))

    expect(complete.enableMcpPlaywright).toBe(true)
  })

  it("returns a typed error when Done has an invalid active display buffer", () => {
    const result = completeCreateDisplaySettingsFlow(
      cwd,
      { ...createFlowViewAtStep(createFeatureRepoDisplaySettingsView(cwd), "gpu"), buffer: "bogus" }
    )

    expect(result?._tag).toBe("Error")
    if (result === null || result._tag !== "Error") {
      throw new TypeError("expected display settings completion error")
    }
    expect(result.error).toEqual({
      _tag: "InvalidOption",
      option: "create",
      reason: "gpu must be one of: none, all, yes, no"
    })
  })

  it("preserves display apply invariants for every settings row", () => {
    fc.assert(
      fc.property(fc.constantFrom(...displaySettingSteps), (stepName) => {
        const view = createFlowViewAtStep(createFeatureRepoDisplaySettingsView(cwd), stepName)
        const beforeValues = { ...view.values }
        const next = expectDisplayModeView(expectCreateContinueView(applyCreateDisplaySettingsStep(
          cwd,
          { ...view, buffer: validBufferByStep[stepName] }
        )))

        expect(next.step).toBe(view.step)
        expect(next.buffer).toBe("")
        expect(resolveCreateDisplaySteps()[next.step]).toBe(stepName)
        expect(resolveCreateDisplaySteps(next.values)).toEqual(resolveCreateDisplaySteps(beforeValues))
        expect(next.values).toEqual({
          ...beforeValues,
          ...next.values
        })
      })
    )
  })

  it("preserves display navigation wraparound and buffer clearing invariants", () => {
    const lastStep = resolveCreateDisplaySteps().length - 1

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: lastStep }),
        fc.constantFrom("up", "down"),
        (step, direction) => {
          const view = { ...createFeatureRepoDisplaySettingsView(cwd), step, buffer: "preview" }
          const next = moveCreateDisplaySettingsStep(view, direction)

          expectCreateNavigationResult(
            next,
            expectedWrappedCreateNavigationStep(step, direction, lastStep),
            view.values
          )
        }
      )
    )
  })

  it("keeps preview rendering and side-arrow choices isolated from committed display values", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...discreteDisplaySteps),
        fc.constantFrom("left", "right"),
        (stepName, direction) => {
          const view = createFlowViewAtStep(createFeatureRepoDisplaySettingsView(cwd), stepName, "typed")
          const beforeValues = { ...view.values }
          const nextBuffer = resolveCreateSettingsChoiceBuffer(view, direction)
          const defaults = resolveCreateInputs(cwd, view.values)
          const label = renderCreateStepLabelWithBufferPreview(stepName, defaults, nextBuffer ?? "")

          expect(nextBuffer).not.toBeNull()
          expect(label.length).toBeGreaterThan(0)
          expect(view.values).toEqual(beforeValues)
        }
      )
    )
  })

  it("renders unapplied buffer previews for discrete settings labels", () => {
    const defaults = resolveCreateInputs(cwd, {})

    expect(renderCreateStepLabelWithBufferPreview("gpu", defaults, "all")).toBe("GPU access [all]")
    expect(renderCreateStepLabelWithBufferPreview("gpu", defaults, "none")).toBe("GPU access [none]")
    expect(renderCreateStepLabelWithBufferPreview("gpu", defaults, "y")).toBe("GPU access [all]")
    expect(renderCreateStepLabelWithBufferPreview("runUp", defaults, "n")).toBe(
      "Run docker compose up now? [N]"
    )
    expect(renderCreateStepLabelWithBufferPreview("mcpPlaywright", defaults, "y")).toBe(
      "Enable Playwright MCP (nested Chromium browser)? [Y]"
    )
    expect(renderCreateStepLabelWithBufferPreview("force", defaults, "y")).toBe(
      "Force recreate (overwrite files + wipe volumes)? [Y]"
    )
  })

  it("preserves committed/default labels for empty, invalid, and free-text preview buffers", () => {
    const defaults = resolveCreateInputs(cwd, {})

    expect(renderCreateStepLabelWithBufferPreview("mcpPlaywright", defaults, "")).toBe(
      "Enable Playwright MCP (nested Chromium browser)? [N]"
    )
    expect(renderCreateStepLabelWithBufferPreview("mcpPlaywright", defaults, "maybe")).toBe(
      "Enable Playwright MCP (nested Chromium browser)? [N]"
    )
    expect(renderCreateStepLabelWithBufferPreview("cpuLimit", defaults, "80%")).toBe("CPU limit [30%]")
    expect(renderCreateStepLabelWithBufferPreview("ramLimit", defaults, "8g")).toBe("RAM limit [30%]")
  })
})
