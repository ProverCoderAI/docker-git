import * as NodeRuntime from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import type { ProjectItem } from "../../src/docker-git/project-item.js"
import { makeProjectItem } from "./fixtures/project-item.js"

type ProjectItemsEffect = Effect.Effect<ReadonlyArray<ProjectItem>>

const listProjectDetailsMock = vi.hoisted(() => vi.fn<() => ProjectItemsEffect>(() => Effect.succeed([])))
const listProjectsMock = vi.hoisted(() => vi.fn(() => Effect.succeed([])))
const getProjectMock = vi.hoisted(() => vi.fn(() => Effect.succeed(null)))

vi.mock("../../src/docker-git/api-client.js", () => ({
  deleteProject: vi.fn(() => Effect.void),
  downProject: vi.fn(() => Effect.void),
  getProject: getProjectMock,
  githubStatus: vi.fn(() => Effect.succeed({})),
  listProjectDetails: listProjectDetailsMock,
  listProjects: listProjectsMock,
  readProjectLogs: vi.fn(() => Effect.succeed("")),
  readProjectPs: vi.fn(() => Effect.succeed("")),
  renderProjectSummaryLine: vi.fn(() => "project")
}))

const loadMenuApi = () => Effect.promise(() => import("../../src/docker-git/menu-api.js"))

describe("menu-api project inventory", () => {
  beforeEach(() => {
    listProjectDetailsMock.mockReset()
    listProjectDetailsMock.mockImplementation(() => Effect.succeed([]))
    listProjectsMock.mockReset()
    listProjectsMock.mockImplementation(() => Effect.succeed([]))
    getProjectMock.mockReset()
    getProjectMock.mockImplementation(() => Effect.succeed(null))
    vi.resetModules()
  })

  it.effect("loads select items from one detailed projects response without per-project fan-out", () =>
    Effect.gen(function*(_) {
      const first = makeProjectItem({ id: "/db/one", projectDir: "/db/one", displayName: "org/one" })
      const second = makeProjectItem({ id: "/db/two", projectDir: "/db/two", displayName: "org/two" })
      listProjectDetailsMock.mockImplementation(() => Effect.succeed([first, second]))

      const { listMenuProjectItems } = yield* _(loadMenuApi())
      const items = yield* _(listMenuProjectItems.pipe(Effect.provide(NodeRuntime.NodeContext.layer)))

      expect(items).toEqual([first, second])
      expect(listProjectDetailsMock).toHaveBeenCalledTimes(1)
      expect(listProjectsMock).not.toHaveBeenCalled()
      expect(getProjectMock).not.toHaveBeenCalled()
    }))

  it.effect("keeps stop selection DB-only when live runtime is not part of inventory", () =>
    Effect.gen(function*(_) {
      const project = makeProjectItem({ id: "/db/project", projectDir: "/db/project", status: "unknown" })
      listProjectDetailsMock.mockImplementation(() => Effect.succeed([project]))

      const { listMenuRunningProjectItems } = yield* _(loadMenuApi())
      const items = yield* _(listMenuRunningProjectItems.pipe(Effect.provide(NodeRuntime.NodeContext.layer)))

      expect(items).toEqual([project])
      expect(listProjectDetailsMock).toHaveBeenCalledTimes(1)
      expect(getProjectMock).not.toHaveBeenCalled()
    }))
})
