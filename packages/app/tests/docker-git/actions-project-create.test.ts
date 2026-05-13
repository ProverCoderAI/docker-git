import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
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

const createInputConfig = {
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

const createInputs: CreateInputs = {
  ...createInputConfig,
  runUp: true
}

const expectedCreateDraft = {
  ...createInputConfig,
  up: createInputs.runUp
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

const projectCreatedEvent: ApiEvent = {
  at: "2026-05-13T00:00:01.000Z",
  payload: {
    project,
    projectId: project.id
  },
  projectId: project.id,
  seq: 8,
  type: "project.created"
}

const readCreateEventHandler = () => {
  const handler = openProjectEventStreamMock.mock.calls[0]?.[1]?.onEvent
  if (handler === undefined) {
    throw new Error("missing create event handler")
  }
  return handler
}

describe("browser create project action", () => {
  beforeEach(() => {
    eventStreamCloseMock.mockReset()
    loadProjectDetailsMock.mockReset()
    openProjectEventStreamMock.mockReset()
    startCreateProjectMock.mockReset()
    startCreateProjectMock.mockImplementation(() =>
      Effect.succeed({
        accepted: true,
        cursor: 7,
        projectId: project.id
      })
    )
    openProjectEventStreamMock.mockImplementation(() => ({ close: eventStreamCloseMock }))
  })

  it.effect("clones a project through the browser menu create flow", () =>
    Effect.gen(function*(_) {
      const { context, output, reloadDashboard, setMessage } = makeBrowserActionContext()

      submitCreateInputs(createInputs, context)

      yield* _(waitForAssertion(() => {
        expect(openProjectEventStreamMock).toHaveBeenCalledTimes(1)
      }))
      readCreateEventHandler()(projectCreatedEvent)

      yield* _(waitForAssertion(() => {
        expect(context.setSelectedProject).toHaveBeenCalledWith(project)
      }))

      expect(startCreateProjectMock).toHaveBeenCalledWith(expectedCreateDraft)
      expect(openProjectEventStreamMock).toHaveBeenCalledWith(project.id, expect.objectContaining({ initialCursor: 7 }))
      expect(eventStreamCloseMock).toHaveBeenCalledTimes(1)
      expect(loadProjectDetailsMock).not.toHaveBeenCalled()
      expect(reloadDashboard).toHaveBeenCalledTimes(1)
      expect(context.setSelectedProjectId).toHaveBeenCalledWith(project.id)
      expect(context.setSelectedMenuIndex).toHaveBeenCalledWith(1)
      expect(setMessage).toHaveBeenLastCalledWith("Created octocat/Hello-World.")
      expect(output()).toContain("[create] Project creation requested")
      expect(output()).toContain("[create] Project accepted: project-1")
      expect(output()).toContain("[create] Project created")
    }))
})
