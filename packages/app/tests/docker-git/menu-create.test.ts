import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { vi } from "vitest"

import { resolveCreateFlowSteps } from "../../src/docker-git/menu-create-shared.js"
import { handleCreateInput } from "../../src/docker-git/menu-create.js"
import type { ViewState } from "../../src/docker-git/menu-types.js"

type CreateView = Extract<ViewState, { readonly _tag: "Create" }>

const settingsValues = {
  outDir: "/home/dev/.docker-git/org/repo",
  repoRef: "feature-x",
  repoUrl: "https://github.com/org/repo/tree/feature-x"
}

const createSettingsView = (): CreateView => ({
  _tag: "Create",
  step: 1,
  buffer: "30%",
  inputError: null,
  values: settingsValues
})

const wrapSettingsStep = (step: number, offset: -1 | 1, settingsStepCount: number): number =>
  ((step - 1 + offset + settingsStepCount) % settingsStepCount) + 1

const expectedSettingsStep = (
  step: number,
  direction: "up" | "down",
  settingsStepCount: number
): number => wrapSettingsStep(step, direction === "up" ? -1 : 1, settingsStepCount)

const createArrowKey = (
  direction: "up" | "down"
): Parameters<typeof handleCreateInput>[1] => direction === "up" ? { upArrow: true } : { downArrow: true }

const createContext = (): Parameters<typeof handleCreateInput>[3] & {
  readonly setViewMock: ReturnType<typeof vi.fn>
  readonly setMessageMock: ReturnType<typeof vi.fn>
} => {
  const setViewMock = vi.fn()
  const setMessageMock = vi.fn()

  return {
    state: { cwd: "/workspace", activeDir: null },
    setView: setViewMock,
    setMessage: setMessageMock,
    runner: { runEffect: vi.fn() },
    setActiveDir: vi.fn(),
    setViewMock,
    setMessageMock
  }
}

describe("menu-create", () => {
  it.effect("moves TUI settings selection with arrows and clears the input buffer", () =>
    Effect.sync(() => {
      const context = createContext()
      const view = createSettingsView()

      handleCreateInput("", { downArrow: true }, view, context)

      expect(context.setViewMock).toHaveBeenCalledWith({
        ...view,
        step: 2,
        buffer: ""
      })
      expect(context.setMessageMock).toHaveBeenCalledWith(null)
    }))

  it.effect("ignores TUI settings arrows before the Settings flow starts", () =>
    Effect.sync(() => {
      const context = createContext()

      handleCreateInput(
        "",
        { downArrow: true },
        { _tag: "Create", step: 0, buffer: "", inputError: null, values: {} },
        context
      )

      expect(context.setViewMock).not.toHaveBeenCalled()
    }))

  it.effect("preserves TUI settings arrow invariants for every settings row", () =>
    Effect.sync(() => {
      const baseView = createSettingsView()
      const settingsStepCount = resolveCreateFlowSteps(baseView.values).length - 1

      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: settingsStepCount }),
          fc.constantFrom<"up" | "down">("up", "down"),
          (step, direction) => {
            const context = createContext()
            const view = { ...baseView, step, buffer: "draft" }

            handleCreateInput("", createArrowKey(direction), view, context)

            expect(context.setViewMock).toHaveBeenCalledWith({
              ...view,
              step: expectedSettingsStep(step, direction, settingsStepCount),
              buffer: ""
            })
            expect(context.setMessageMock).toHaveBeenCalledWith(null)
          }
        )
      )
    }))
})
