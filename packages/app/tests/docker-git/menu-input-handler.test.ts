import { describe, expect, it, vi } from "vitest"

import { handleUserInput } from "../../src/docker-git/menu-input-handler.js"
import type { MenuInputContext } from "../../src/docker-git/menu-input-handler.js"

const makeContext = (inputStage: "cold" | "active"): MenuInputContext & {
  readonly runnerRunEffect: ReturnType<typeof vi.fn>
  readonly setViewMock: ReturnType<typeof vi.fn>
  readonly setMessageMock: ReturnType<typeof vi.fn>
  readonly setInputStageMock: ReturnType<typeof vi.fn>
  readonly setSkipInputsMock: ReturnType<typeof vi.fn>
} => {
  let currentInputStage = inputStage
  const runnerRunEffect = vi.fn()
  const runnerRunInteractiveEffect = vi.fn()
  const setViewMock = vi.fn()
  const setMessageMock = vi.fn()
  const setSkipInputsMock = vi.fn()
  const setInputStageMock = vi.fn((next: "cold" | "active") => {
    currentInputStage = next
  })

  return {
    busy: false,
    view: { _tag: "Menu" },
    get inputStage() {
      return currentInputStage
    },
    setInputStage: setInputStageMock,
    selected: 0,
    setSelected: vi.fn(),
    setSkipInputs: setSkipInputsMock,
    sshActive: false,
    setSshActive: vi.fn(),
    state: { cwd: process.cwd(), activeDir: null },
    runner: { runEffect: runnerRunEffect, runInteractiveEffect: runnerRunInteractiveEffect },
    exit: vi.fn(),
    setView: setViewMock,
    setMessage: setMessageMock,
    setActiveDir: vi.fn(),
    runnerRunEffect,
    setViewMock,
    setMessageMock,
    setInputStageMock,
    setSkipInputsMock
  }
}

describe("menu-input-handler", () => {
  it("swallows the first single-character alias on cold start", () => {
    const context = makeContext("cold")

    handleUserInput("s", {}, context)

    expect(context.setInputStageMock).toHaveBeenCalledWith("active")
    expect(context.runnerRunEffect).not.toHaveBeenCalled()
    expect(context.setViewMock).not.toHaveBeenCalled()
    expect(context.setMessageMock).not.toHaveBeenCalled()
  })

  it("allows the same alias once input is already active", () => {
    const context = makeContext("active")

    handleUserInput("s", {}, context)

    expect(context.runnerRunEffect).toHaveBeenCalledTimes(1)
    expect(context.setSkipInputsMock).toHaveBeenCalledTimes(1)
  })
})
