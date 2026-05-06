import { describe, expect, it, vi } from "vitest"

import { openTerminalTaskManager } from "../../src/web/app-ready-terminal-actions.js"
import { browserMenuIndex } from "../../src/web/menu.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"

const loadProjectTasksByIdMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/actions.js", () => ({
  applyProjectById: vi.fn(),
  applySelectedProject: vi.fn(),
  attachProjectTerminalById: vi.fn(),
  connectProjectById: vi.fn(),
  loadProjectTasksById: loadProjectTasksByIdMock,
  runApplyAllProjects: vi.fn()
}))

vi.mock("../../src/web/api.js", () => ({
  deleteProjectTerminalSession: vi.fn()
}))

describe("app-ready terminal actions", () => {
  it("keeps terminal workspace active when opening task manager from an SSH session", () => {
    const setActiveScreen = vi.fn()
    const setProjectTaskLogs = vi.fn()
    const setProjectTasks = vi.fn()
    const setProjectTasksIncludeDefault = vi.fn()
    const setSelectedMenuIndex = vi.fn()
    const setSelectedProjectId = vi.fn()
    const { context } = makeBrowserActionContext({ setActiveScreen })
    const state = {
      setProjectTaskLogs,
      setProjectTasks,
      setProjectTasksIncludeDefault,
      setSelectedMenuIndex,
      setSelectedProjectId
    }

    openTerminalTaskManager(context, state, "project-1")

    expect(setSelectedProjectId).toHaveBeenCalledWith("project-1")
    expect(setSelectedMenuIndex).toHaveBeenCalledWith(browserMenuIndex("Tasks"))
    expect(setProjectTasks).toHaveBeenCalledWith(null)
    expect(setProjectTaskLogs).toHaveBeenCalledWith("")
    expect(setProjectTasksIncludeDefault).toHaveBeenCalledWith(false)
    expect(loadProjectTasksByIdMock).toHaveBeenCalledWith(context, "project-1", { includeDefault: false })
    expect(setActiveScreen).not.toHaveBeenCalled()
  })
})
