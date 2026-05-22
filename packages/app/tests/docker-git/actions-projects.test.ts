import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import { applyProjectById, runApplyAllProjects } from "../../src/web/actions-projects.js"
import type { applyAllProjects, applyProject } from "../../src/web/api.js"
import { project } from "./actions-project-terminal-test-fixtures.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const applyAllProjectsMock = vi.hoisted(() => vi.fn<typeof applyAllProjects>())
const applyProjectMock = vi.hoisted(() => vi.fn<typeof applyProject>())

vi.mock("../../src/web/api.js", () => ({
  applyAllProjects: applyAllProjectsMock,
  applyProject: applyProjectMock,
  deleteProject: vi.fn(),
  downAllProjects: vi.fn(),
  downProject: vi.fn(),
  loadProjectDetails: vi.fn(),
  loadProjectLogs: vi.fn(),
  loadProjectPs: vi.fn(),
  loadProjectTerminalSession: vi.fn(),
  startProjectTerminalSession: vi.fn()
}))

vi.mock("../../src/web/actions-browser.js", () => ({
  openSelectedProjectBrowser: vi.fn()
}))

vi.mock("../../src/web/actions-databases.js", () => ({
  openSelectedProjectDatabaseEditor: vi.fn()
}))

vi.mock("../../src/web/actions-output.js", () => ({
  appendOutputLine: vi.fn(),
  appendOutputLineHandler: vi.fn(() => vi.fn()),
  notifyProjectEventRateLimit: vi.fn()
}))

vi.mock("../../src/web/actions-port-forwards.js", () => ({
  openSelectedProjectPort: vi.fn()
}))

vi.mock("../../src/web/project-events.js", () => ({
  openProjectEventStream: vi.fn()
}))

describe("web project actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    applyAllProjectsMock.mockReset()
    applyProjectMock.mockReset()
    vi.unstubAllGlobals()
  })

  it.effect("applies a selected project through the project apply endpoint", () =>
    Effect.gen(function*(_) {
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal("confirm", confirmMock)
      applyProjectMock.mockImplementation(() => Effect.succeed(project))
      const { context, reloadDashboard, setMessage } = makeBrowserActionContext({
        selectedProjectId: "project-1",
        selectedProjectName: "octocat/hello-world"
      })

      applyProjectById("project-1", context)

      yield* _(waitForAssertion(() => {
        expect(applyProjectMock).toHaveBeenCalledWith("project-1", undefined)
      }))

      expect(confirmMock).toHaveBeenCalledWith(
        "Apply docker-git config to octocat/hello-world? "
          + "This restarts the container and ends active SSH sessions and in-container browsers."
      )
      expect(context.setSelectedProjectId).toHaveBeenCalledWith("project-1")
      expect(context.setSelectedProject).toHaveBeenCalledWith(project)
      expect(reloadDashboard).toHaveBeenCalledTimes(1)
      expect(setMessage).toHaveBeenLastCalledWith("Applied octocat/hello-world (GPU none).")
    }))

  it("does not apply a project when the user declines confirmation", () => {
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal("confirm", confirmMock)
    applyProjectMock.mockImplementation(() => Effect.succeed(project))
    const { context, reloadDashboard } = makeBrowserActionContext({
      selectedProjectId: "project-1",
      selectedProjectName: "octocat/hello-world"
    })

    applyProjectById("project-1", context)

    expect(confirmMock).toHaveBeenCalledWith(
      "Apply docker-git config to octocat/hello-world? "
        + "This restarts the container and ends active SSH sessions and in-container browsers."
    )
    expect(applyProjectMock).not.toHaveBeenCalled()
    expect(context.setSelectedProjectId).not.toHaveBeenCalled()
    expect(reloadDashboard).not.toHaveBeenCalled()
  })

  it.effect("confirms and applies all projects", () =>
    Effect.gen(function*(_) {
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal("confirm", confirmMock)
      applyAllProjectsMock.mockImplementation(() => Effect.void)
      const { context, reloadDashboard, setMessage } = makeBrowserActionContext()

      runApplyAllProjects(context)

      yield* _(waitForAssertion(() => {
        expect(applyAllProjectsMock).toHaveBeenCalledWith(false)
      }))

      expect(reloadDashboard).toHaveBeenCalledTimes(1)
      expect(setMessage).toHaveBeenLastCalledWith("Applied docker-git config to all projects.")
    }))
})
