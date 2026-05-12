import { describe, expect, it } from "vitest"

import { type ProjectHandlers, useProjectActionHandlers } from "../../src/web/app-terminal-session-handlers.js"

const noopMessage = (_message: string | null): void => {}
const noopOpenTaskManager = (): void => {}

const buildHandlers = (
  overrides: Partial<Parameters<typeof useProjectActionHandlers>[0]> = {}
): ProjectHandlers =>
  useProjectActionHandlers({
    onOpenTaskManagerRequest: noopOpenTaskManager,
    projectId: "project-1",
    projectKey: "octocat/hello-world",
    projectLabel: "octocat/hello-world",
    setMessage: noopMessage,
    ...overrides
  })

describe("useProjectActionHandlers", () => {
  it("returns all four project action handlers when project context is present", () => {
    const handlers = buildHandlers()
    expect(typeof handlers.onApplyProject).toBe("function")
    expect(typeof handlers.onOpenBrowser).toBe("function")
    expect(typeof handlers.onOpenTaskManager).toBe("function")
    expect(typeof handlers.onOpenTerminal).toBe("function")
  })

  it("hides all handlers when projectId is missing", () => {
    const handlers = buildHandlers({ projectId: undefined })
    expect(handlers.onApplyProject).toBeUndefined()
    expect(handlers.onOpenBrowser).toBeUndefined()
    expect(handlers.onOpenTaskManager).toBeUndefined()
    expect(handlers.onOpenTerminal).toBeUndefined()
  })

  it("hides only onOpenTerminal when projectKey is missing", () => {
    const handlers = buildHandlers({ projectKey: undefined })
    expect(typeof handlers.onApplyProject).toBe("function")
    expect(typeof handlers.onOpenBrowser).toBe("function")
    expect(typeof handlers.onOpenTaskManager).toBe("function")
    expect(handlers.onOpenTerminal).toBeUndefined()
  })

  it("wires onOpenTaskManager to the supplied request callback", () => {
    let opened = 0
    const handlers = buildHandlers({
      onOpenTaskManagerRequest: () => {
        opened += 1
      }
    })
    handlers.onOpenTaskManager?.()
    expect(opened).toBe(1)
  })
})
