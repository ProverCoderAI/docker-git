import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { beforeEach, vi } from "vitest"

import type { CreateInputs } from "../../src/docker-git/menu-types.js"
import { submitCreateInputs } from "../../src/web/actions-project-create.js"
import type { ApiEvent, loadProjectDetails, ProjectDetails, startCreateProject } from "../../src/web/api.js"
import type { openProjectEventStream } from "../../src/web/project-events.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const eventStreamCloseMock = vi.hoisted(() => vi.fn<() => void>())
const loadProjectDetailsMock = vi.hoisted(() => vi.fn<typeof loadProjectDetails>())
const openProjectEventStreamMock = vi.hoisted(() => vi.fn<typeof openProjectEventStream>())
const startCreateProjectMock = vi.hoisted(() => vi.fn<typeof startCreateProject>())

vi.mock("../../src/web/api.js", () => ({
  loadProjectDetails: loadProjectDetailsMock,
  startCreateProject: startCreateProjectMock
}))

vi.mock("../../src/web/project-events.js", () => ({
  openProjectEventStream: openProjectEventStreamMock
}))

const inputConfig = {
  cpuLimit: "75%",
  enableMcpPlaywright: true,
  force: false,
  forceEnv: false,
  gpu: "none",
  outDir: "/home/dev/.docker-git/octocat/Hello-World",
  ramLimit: "1g",
  repoRef: "main",
  repoUrl: "https://github.com/octocat/Hello-World.git"
} satisfies Omit<CreateInputs, "runUp">

const inputs: CreateInputs = {
  ...inputConfig,
  runUp: true
}

const expectedCreateDraft = {
  ...inputConfig,
  up: inputs.runUp
}

const project = {
  authorizedKeysExists: true,
  authorizedKeysPath: "/home/dev/.docker-git/octocat/Hello-World/.ssh/authorized_keys",
  clonedOnHostname: "runner",
  codexAuthPath: "/home/dev/.docker-git/.orch/auth/codex",
  codexHome: "/home/dev/.docker-git/.orch/codex",
  containerName: "docker-git-octocat-hello-world",
  displayName: "octocat/Hello-World",
  envGlobalPath: "/home/dev/.docker-git/.orch/env/global.env",
  envProjectPath: "/home/dev/.docker-git/octocat/Hello-World/.orch/env/project.env",
  gpu: "none",
  id: "project-1",
  projectDir: "/home/dev/.docker-git/octocat/Hello-World",
  projectKey: "octocat/Hello-World",
  repoRef: "main",
  repoUrl: "https://github.com/octocat/Hello-World.git",
  serviceName: "app",
  sshCommand: "ssh -p 2244 dev@127.0.0.1",
  sshPort: 2244,
  sshSessions: 0,
  sshUser: "dev",
  startedAtEpochMs: 1_777_000_000_000,
  startedAtIso: "2026-05-13T00:00:00.000Z",
  status: "running",
  statusLabel: "running",
  targetDir: "/home/dev/project"
} satisfies ProjectDetails

const projectDetailsWithId = (projectId: string) =>
  ({
    ...project,
    id: projectId
  }) satisfies ProjectDetails

const projectCreatedEventFor = (
  createdProject: ReturnType<typeof projectDetailsWithId>
): ApiEvent => ({
  at: "2026-05-13T00:00:01.000Z",
  payload: {
    project: createdProject,
    projectId: createdProject.id
  },
  projectId: createdProject.id,
  seq: 8,
  type: "project.created"
})

const readCreateEventHandler = () => {
  const handler = openProjectEventStreamMock.mock.calls[0]?.[1]?.onEvent
  if (handler === undefined) {
    throw new Error("missing create event handler")
  }
  return handler
}

const resetCreateMocks = (
  projectId = project.id,
  cursor = 7
) => {
  eventStreamCloseMock.mockReset()
  loadProjectDetailsMock.mockReset()
  openProjectEventStreamMock.mockReset()
  startCreateProjectMock.mockReset()
  startCreateProjectMock.mockImplementation(() =>
    Effect.succeed({
      accepted: true,
      cursor,
      projectId
    })
  )
  openProjectEventStreamMock.mockImplementation(() => ({ close: eventStreamCloseMock }))
}

const runCreateFlow = (
  createdProject: ReturnType<typeof projectDetailsWithId>
) =>
  Effect.gen(function*(_) {
    const { context, output, reloadDashboard, setMessage } = makeBrowserActionContext()

    submitCreateInputs(inputs, context)

    yield* _(waitForAssertion(() => {
      expect(openProjectEventStreamMock).toHaveBeenCalledTimes(1)
    }))
    readCreateEventHandler()(projectCreatedEventFor(createdProject))

    yield* _(waitForAssertion(() => {
      expect(context.setSelectedProject).toHaveBeenCalledWith(createdProject)
    }))

    return { context, createdProject, output, reloadDashboard, setMessage }
  })

const expectCreateFlowInvariants = (
  {
    context,
    createdProject,
    cursor,
    reloadDashboard
  }: {
    readonly context: ReturnType<typeof makeBrowserActionContext>["context"]
    readonly createdProject: ReturnType<typeof projectDetailsWithId>
    readonly cursor: number
    readonly reloadDashboard: ReturnType<typeof makeBrowserActionContext>["reloadDashboard"]
  }
) => {
  expect(openProjectEventStreamMock).toHaveBeenCalledWith(
    createdProject.id,
    expect.objectContaining({ initialCursor: cursor })
  )
  expect(eventStreamCloseMock).toHaveBeenCalledTimes(1)
  expect(loadProjectDetailsMock).not.toHaveBeenCalled()
  expect(reloadDashboard).toHaveBeenCalledTimes(1)
  expect(context.setSelectedProjectId).toHaveBeenCalledWith(createdProject.id)
  expect(context.setSelectedProject).toHaveBeenCalledWith(createdProject)
}

describe("browser create project action", () => {
  beforeEach(() => {
    resetCreateMocks()
  })

  it.effect("clones a project through the browser menu create flow", () =>
    Effect.gen(function*(_) {
      const { context, createdProject, output, reloadDashboard, setMessage } = yield* _(
        runCreateFlow(projectDetailsWithId(project.id))
      )

      expect(startCreateProjectMock).toHaveBeenCalledWith(expectedCreateDraft)
      expectCreateFlowInvariants({ context, createdProject, cursor: 7, reloadDashboard })
      expect(context.setSelectedMenuIndex).toHaveBeenCalledWith(1)
      expect(setMessage).toHaveBeenLastCalledWith("Created octocat/Hello-World.")
      expect(output()).toContain("[create] Project creation requested")
      expect(output()).toContain("[create] Project accepted: project-1")
      expect(output()).toContain("[create] Project created")
    }))

  it.effect("preserves create event invariants for generated project ids and cursors", () =>
    Effect.tryPromise({
      catch: (error) => error,
      try: () =>
        fc.assert(
          fc.asyncProperty(
            fc.uuid(),
            fc.integer({ min: 0, max: 10_000 }),
            (projectId, cursor) =>
              Effect.runPromise(
                Effect.gen(function*(_) {
                  resetCreateMocks(projectId, cursor)
                  const createdProject = projectDetailsWithId(projectId)
                  const { context, reloadDashboard } = yield* _(runCreateFlow(createdProject))

                  expectCreateFlowInvariants({ context, createdProject, cursor, reloadDashboard })
                })
              )
          ),
          { numRuns: 25 }
        )
    }))
})
