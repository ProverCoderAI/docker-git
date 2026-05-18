import { describe, expect, it } from "vitest"

import {
  advanceCreateFlow,
  applyCreateDisplaySettingsStep,
  completeCreateDisplaySettingsFlow,
  createInitialFlowView,
  moveCreateDisplaySettingsStep,
  renderCreateStepLabelWithBufferPreview,
  resolveCreateDisplaySteps,
  resolveCreateInputs,
  resolveCreateSettingsChoiceBuffer
} from "../../src/docker-git/menu-create-shared.js"
import type { CreateStep } from "../../src/docker-git/menu-types.js"

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

const viewForStep = (
  view: ReturnType<typeof expectContinueResult>,
  stepName: CreateStep
): ReturnType<typeof expectContinueResult> => {
  const step = resolveCreateDisplaySteps().indexOf(stepName)
  if (step === -1) {
    throw new TypeError(`expected Create step: ${stepName}`)
  }
  return { ...view, step, buffer: "draft" }
}

describe("menu-create-shared display settings", () => {
  const cwd = process.cwd()

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
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))
    const mcpView = viewForStep(view, "mcpPlaywright")
    const next = expectContinueResult(applyCreateDisplaySettingsStep(cwd, { ...mcpView, buffer: "y" }))

    expect(next.step).toBe(mcpView.step)
    expect(next.buffer).toBe("")
    expect(next.values.enableMcpPlaywright).toBe(true)
    expect(resolveCreateDisplaySteps()[next.step]).toBe("mcpPlaywright")
  })

  it("navigates browser display settings without skipping applied rows", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))
    const applied = expectContinueResult(applyCreateDisplaySettingsStep(
      cwd,
      { ...viewForStep(view, "mcpPlaywright"), buffer: "y" }
    ))
    const down = moveCreateDisplaySettingsStep(applied, "down")
    const up = moveCreateDisplaySettingsStep(applied, "up")

    expect(down?.step).toBe(resolveCreateDisplaySteps().indexOf("force"))
    expect(up?.step).toBe(resolveCreateDisplaySteps().indexOf("runUp"))
    expect(down?.buffer).toBe("")
    expect(up?.values.enableMcpPlaywright).toBe(true)
  })

  it("resolves horizontal choices against applied browser display rows", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))
    const applied = expectContinueResult(applyCreateDisplaySettingsStep(
      cwd,
      { ...viewForStep(view, "mcpPlaywright"), buffer: "y" }
    ))

    expect(resolveCreateSettingsChoiceBuffer(applied, "left")).toBe("n")
    expect(resolveCreateSettingsChoiceBuffer(applied, "right")).toBe("y")
  })

  it("completes browser display settings with a valid active buffer", () => {
    const view = expectContinueResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))
    const complete = expectCompleteResult(completeCreateDisplaySettingsFlow(
      cwd,
      { ...viewForStep(view, "mcpPlaywright"), buffer: "y" }
    ))

    expect(complete.enableMcpPlaywright).toBe(true)
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
