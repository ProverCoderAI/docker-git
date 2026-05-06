import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import {
  loadSelectedProjectTaskLogs,
  loadSelectedProjectTasks,
  setSelectedProjectTasksIncludeDefault,
  stopSelectedProjectTask
} from "../../src/web/actions-tasks.js"
import type { ContainerTaskSnapshot } from "../../src/web/api.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const loadProjectTaskLogsMock = vi.hoisted(() => vi.fn())
const loadProjectTasksMock = vi.hoisted(() => vi.fn())
const stopProjectTaskMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/api.js", () => ({
  loadProjectTaskLogs: loadProjectTaskLogsMock,
  loadProjectTasks: loadProjectTasksMock,
  stopProjectTask: stopProjectTaskMock
}))

const taskSnapshot = (
  tasks: ContainerTaskSnapshot["tasks"]
): ContainerTaskSnapshot => ({
  containerName: "project-dev",
  generatedAt: "2026-05-05T00:00:00.000Z",
  projectId: "project-1",
  sshConnections: 1,
  tasks
})

const task = (
  pid: number,
  command: string
): ContainerTaskSnapshot["tasks"][number] => ({
  command,
  etime: "00:01",
  etimes: 1,
  kind: "background",
  logAvailable: false,
  pid,
  ppid: 1,
  tty: "?",
  user: "dev"
})

describe("web task actions", () => {
  beforeEach(() => {
    loadProjectTaskLogsMock.mockReset()
    loadProjectTasksMock.mockReset()
    stopProjectTaskMock.mockReset()
    vi.stubGlobal("confirm", vi.fn(() => true))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect("loads selected project tasks with the active system visibility flag", () =>
    Effect.gen(function*(_) {
      const snapshot = taskSnapshot([task(42, "node server.js")])
      loadProjectTasksMock.mockImplementation(() => Effect.succeed(snapshot))
      const setProjectTasks = vi.fn()
      const { context, setMessage } = makeBrowserActionContext({
        projectTasksIncludeDefault: true,
        selectedProjectId: "project-1",
        setProjectTasks
      })

      loadSelectedProjectTasks(context)

      yield* _(waitForAssertion(() => {
        expect(setProjectTasks).toHaveBeenCalledWith(snapshot)
      }))

      expect(loadProjectTasksMock).toHaveBeenCalledWith("project-1", true)
      expect(setMessage).toHaveBeenLastCalledWith("Loaded 1 container task(s).")
    }))

  it.effect("toggles system process visibility and reloads tasks", () =>
    Effect.gen(function*(_) {
      const snapshot = taskSnapshot([task(1, "init"), task(42, "node server.js")])
      loadProjectTasksMock.mockImplementation(() => Effect.succeed(snapshot))
      const setProjectTaskLogs = vi.fn()
      const setProjectTasks = vi.fn()
      const setProjectTasksIncludeDefault = vi.fn()
      const { context } = makeBrowserActionContext({
        selectedProjectId: "project-1",
        setProjectTaskLogs,
        setProjectTasks,
        setProjectTasksIncludeDefault
      })

      setSelectedProjectTasksIncludeDefault(context, true)

      yield* _(waitForAssertion(() => {
        expect(setProjectTasks).toHaveBeenCalledWith(snapshot)
      }))

      expect(setProjectTasksIncludeDefault).toHaveBeenCalledWith(true)
      expect(setProjectTaskLogs).toHaveBeenCalledWith("")
      expect(loadProjectTasksMock).toHaveBeenCalledWith("project-1", true)
    }))

  it.effect("stops a task and refreshes the snapshot before updating state", () =>
    Effect.gen(function*(_) {
      const refreshed = taskSnapshot([task(42, "sleep 100"), task(43, "node server.js")])
      stopProjectTaskMock.mockImplementation(() => Effect.void)
      loadProjectTasksMock.mockImplementation(() => Effect.succeed(refreshed))
      const setProjectTasks = vi.fn()
      const { context, setMessage } = makeBrowserActionContext({
        selectedProjectId: "project-1",
        setProjectTasks
      })

      stopSelectedProjectTask(context, 42)

      yield* _(waitForAssertion(() => {
        expect(setProjectTasks).toHaveBeenCalled()
      }))

      expect(stopProjectTaskMock).toHaveBeenCalledWith("project-1", 42)
      expect(loadProjectTasksMock).toHaveBeenCalledWith("project-1", false)
      expect(setProjectTasks).toHaveBeenLastCalledWith({
        ...refreshed,
        tasks: [task(43, "node server.js")]
      })
      expect(setMessage).toHaveBeenLastCalledWith("Sent SIGTERM to PID 42.")
    }))

  it.effect("loads task logs into task log state", () =>
    Effect.gen(function*(_) {
      loadProjectTaskLogsMock.mockImplementation(() => Effect.succeed("line one\nline two"))
      const setProjectTaskLogs = vi.fn()
      const { context, setMessage } = makeBrowserActionContext({
        selectedProjectId: "project-1",
        setProjectTaskLogs
      })

      loadSelectedProjectTaskLogs(context, 42)

      yield* _(waitForAssertion(() => {
        expect(setProjectTaskLogs).toHaveBeenCalledWith("line one\nline two")
      }))

      expect(loadProjectTaskLogsMock).toHaveBeenCalledWith("project-1", 42, 200)
      expect(setMessage).toHaveBeenLastCalledWith("Loaded logs for PID 42.")
    }))

  it("clears task state when no project is selected", () => {
    const setProjectTaskLogs = vi.fn()
    const setProjectTasks = vi.fn()
    const { context, setMessage } = makeBrowserActionContext({
      setProjectTaskLogs,
      setProjectTasks
    })

    loadSelectedProjectTasks(context)

    expect(loadProjectTasksMock).not.toHaveBeenCalled()
    expect(setProjectTaskLogs).toHaveBeenCalledWith("")
    expect(setProjectTasks).toHaveBeenCalledWith(null)
    expect(setMessage).toHaveBeenLastCalledWith("No project selected.")
  })
})
