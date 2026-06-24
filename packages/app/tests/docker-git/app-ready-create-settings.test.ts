import { beforeEach, describe, expect, it, vi } from "vitest"

import type { submitCreateInputs } from "../../src/web/actions-projects.js"
import { didHandleCreateKey, submitCreateView } from "../../src/web/app-ready-create.js"
import {
  type CreateFlowView,
  createInitialFlowView,
  createSettingsFlowView,
  createSettingsFlowViewAtStep,
  type CreateStep,
  expectCreateArrowHandling,
  expectCreateSideArrowBufferHandling,
  expectCreateViewReset,
  expectIgnoredCreateKey,
  requireCreateViewValue,
  requireSubmittedCreateInputs,
  resolveCreateDisplaySteps,
  runCreateKey,
  runSubmitCreateView
} from "./app-ready-create-fixture.js"

const actionSpies = vi.hoisted(() => ({
  submitProjectCreate: vi.fn<typeof submitCreateInputs>()
}))

vi.mock("../../src/web/actions-projects.js", () => {
  const actionsProjectModule = { submitCreateInputs: actionSpies.submitProjectCreate }
  return actionsProjectModule
})

const submitCreateInputsMock = actionSpies.submitProjectCreate

describe("app-ready-create settings", () => {
  beforeEach(() => {
    submitCreateInputsMock.mockReset()
  })

  it("moves between settings with arrows and clears the uncommitted buffer", () => {
    expectCreateArrowHandling(didHandleCreateKey, "ArrowDown", (view) => view.step + 1)
  })

  it("wraps settings selection upward with ArrowUp and clears the uncommitted buffer", () => {
    expectCreateArrowHandling(didHandleCreateKey, "ArrowUp", () => resolveCreateDisplaySteps().length - 1)
  })

  it("fills discrete settings buffers with side arrows without applying values", () => {
    const cases: ReadonlyArray<{
      readonly expectedBuffer: string
      readonly key: "ArrowLeft" | "ArrowRight"
      readonly stepName: CreateStep
    }> = [
      { expectedBuffer: "none", key: "ArrowLeft", stepName: "gpu" },
      { expectedBuffer: "all", key: "ArrowRight", stepName: "gpu" },
      { expectedBuffer: "n", key: "ArrowLeft", stepName: "runUp" },
      { expectedBuffer: "y", key: "ArrowRight", stepName: "runUp" },
      { expectedBuffer: "n", key: "ArrowLeft", stepName: "mcpPlaywright" },
      { expectedBuffer: "y", key: "ArrowRight", stepName: "mcpPlaywright" },
      { expectedBuffer: "n", key: "ArrowLeft", stepName: "force" },
      { expectedBuffer: "y", key: "ArrowRight", stepName: "force" }
    ]

    for (const { expectedBuffer, key, stepName } of cases) {
      submitCreateInputsMock.mockReset()
      expectCreateSideArrowBufferHandling(didHandleCreateKey, submitCreateInputsMock, key, stepName, expectedBuffer)
    }
  })

  it("applies a side-arrow choice only after Enter", () => {
    const arrowResult = runCreateKey(didHandleCreateKey, createSettingsFlowViewAtStep("gpu", "typed"), "ArrowRight")
    const arrowView = requireCreateViewValue(arrowResult.setCreateViewSpy.mock.calls[0]?.[0])
    const enterResult = runCreateKey(didHandleCreateKey, arrowView, "Enter")
    const enteredView = requireCreateViewValue(enterResult.setCreateViewSpy.mock.calls[0]?.[0])

    expect(arrowResult.handled).toBe(true)
    expect(arrowView.values.gpu).toBeUndefined()
    expect(enterResult.handled).toBe(true)
    expect(enteredView.values.gpu).toBe("all")
    expect(enteredView.step).toBe(resolveCreateDisplaySteps().indexOf("runUp"))
    expect(enteredView.buffer).toBe("")
    expect(submitCreateInputsMock).not.toHaveBeenCalled()
  })

  it("wraps to the first settings row after applying the last settings row", () => {
    const creationView: CreateFlowView = {
      ...createSettingsFlowViewAtStep("force", "y"),
      values: {
        ...createSettingsFlowView().values,
        cpuLimit: "40%",
        enableMcpPlaywright: true,
        gpu: "all",
        ramLimit: "8g",
        runUp: false
      }
    }
    const { handled: isHandled, setCreateViewSpy } = runCreateKey(didHandleCreateKey, creationView, "Enter")
    const enteredView = requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])

    expect(isHandled).toBe(true)
    expect(enteredView.values.force).toBe(true)
    expect(enteredView.step).toBe(resolveCreateDisplaySteps().indexOf("cpuLimit"))
    expect(enteredView.buffer).toBe("")
    expect(submitCreateInputsMock).not.toHaveBeenCalled()
  })

  it("keeps the previous setting value when Enter applies an empty buffer", () => {
    const creationView: CreateFlowView = {
      ...createSettingsFlowViewAtStep("runUp", ""),
      values: {
        ...createSettingsFlowView().values,
        runUp: false
      }
    }
    const emptyResult = runCreateKey(didHandleCreateKey, creationView, "Enter")
    const emptyView = requireCreateViewValue(emptyResult.setCreateViewSpy.mock.calls[0]?.[0])

    expect(emptyResult.handled).toBe(true)
    expect(emptyView.step).toBe(resolveCreateDisplaySteps().indexOf("mcpPlaywright"))
    expect(emptyView.values.runUp).toBe(false)
    expect(emptyView.buffer).toBe("")
  })

  it("navigates to the next visible row after applying a settings row", () => {
    const enterResult = runCreateKey(didHandleCreateKey, createSettingsFlowViewAtStep("mcpPlaywright", "y"), "Enter")
    const enteredView = requireCreateViewValue(enterResult.setCreateViewSpy.mock.calls[0]?.[0])

    expect(enterResult.handled).toBe(true)
    expect(enteredView.step).toBe(resolveCreateDisplaySteps().indexOf("mcpAndroid"))
    expect(enteredView.values.enableMcpPlaywright).toBe(true)
    expect(enteredView.buffer).toBe("")
  })

  it("clears an unconfirmed preview when navigating away from a settings row", () => {
    const creationView = createSettingsFlowViewAtStep("mcpPlaywright", "y")
    const { handled: isHandled, setCreateViewSpy } = runCreateKey(didHandleCreateKey, creationView, "ArrowDown")
    const nextView = requireCreateViewValue(setCreateViewSpy.mock.calls[0]?.[0])

    expect(isHandled).toBe(true)
    expect(nextView.step).toBe(resolveCreateDisplaySteps().indexOf("mcpAndroid"))
    expect(nextView.values.enableMcpPlaywright).toBeUndefined()
    expect(nextView.buffer).toBe("")
  })

  it("submits settings Done with a valid active preview applied first", () => {
    const { setCreateViewSpy } = runSubmitCreateView(
      submitCreateView,
      createSettingsFlowViewAtStep("mcpPlaywright", "y"),
      { mode: "complete-settings" }
    )

    expect(submitCreateInputsMock).toHaveBeenCalledTimes(1)
    expect(requireSubmittedCreateInputs(submitCreateInputsMock).enableMcpPlaywright).toBe(true)
    expectCreateViewReset(setCreateViewSpy)
  })

  it("shows a parse error when settings Done has an invalid active preview", () => {
    const { context, setCreateViewSpy } = runSubmitCreateView(
      submitCreateView,
      createSettingsFlowViewAtStep("gpu", "bogus"),
      { mode: "complete-settings" }
    )

    expect(submitCreateInputsMock).not.toHaveBeenCalled()
    expect(setCreateViewSpy).not.toHaveBeenCalled()
    expect(context.setMessage).toHaveBeenCalledWith("Invalid option create: gpu must be one of: none, all, yes, no")
  })

  it("ignores settings arrows before the Settings flow starts", () => {
    expectIgnoredCreateKey(
      didHandleCreateKey,
      createInitialFlowView("https://github.com/org/repo"),
      "ArrowDown"
    )
  })

  it("ignores side arrows before Settings and on free-text settings", () => {
    const keys: ReadonlyArray<"ArrowLeft" | "ArrowRight"> = ["ArrowLeft", "ArrowRight"]
    const views: ReadonlyArray<CreateFlowView> = [
      createInitialFlowView("https://github.com/org/repo"),
      createSettingsFlowViewAtStep("cpuLimit"),
      createSettingsFlowViewAtStep("ramLimit")
    ]

    for (const key of keys) {
      for (const creationView of views) {
        expectIgnoredCreateKey(didHandleCreateKey, creationView, key)
      }
    }
  })
})
