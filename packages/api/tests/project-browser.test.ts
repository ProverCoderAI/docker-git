import { describe, expect, it } from "@effect/vitest"
import { NodeContext } from "@effect/platform-node"
import { Effect } from "effect"
import path from "node:path"
import { beforeEach, vi } from "vitest"

import type { ProjectItem } from "@effect-template/lib"
import { CommandFailedError } from "@effect-template/lib/shell/errors"

import { ApiConflictError } from "../src/api/errors.js"
import { startProjectBrowserSession } from "../src/services/project-browser.js"

const getProjectItemByIdMock = vi.hoisted(() => vi.fn())
const runCommandCaptureMock = vi.hoisted(() => vi.fn())

vi.mock("@effect-template/lib/shell/command-runner", () => ({
  runCommandCapture: runCommandCaptureMock
}))

vi.mock("../src/services/projects.js", () => ({
  getProjectItemById: getProjectItemByIdMock
}))

const projectId = "/home/dev/.docker-git/projects/repo-issue-353"
const projectDir = "/home/dev/.docker-git/projects/repo-issue-353"
const projectContainerName = "dg-docker-git-issue-353"
const browserContainerName = `${projectContainerName}-browser`

const projectItem: ProjectItem = {
  authorizedKeysExists: true,
  authorizedKeysPath: path.join(projectDir, "authorized_keys"),
  codexAuthPath: path.join(projectDir, ".orch", "auth", "codex"),
  codexHome: "/home/dev/.codex",
  containerName: projectContainerName,
  displayName: "ProverCoderAI/docker-git",
  envGlobalPath: path.join(projectDir, ".orch", "env", "global.env"),
  envProjectPath: path.join(projectDir, ".orch", "env", "project.env"),
  gpu: "none",
  lastKnownStatus: "running",
  lastStartAction: "up",
  lastStartedAtEpochMs: 1_778_000_000_000,
  lastStartedAtIso: "2026-05-29T18:00:00.000Z",
  projectDir,
  repoRef: "issue-353",
  repoUrl: "https://github.com/ProverCoderAI/docker-git.git",
  serviceName: "app",
  sshCommand: "ssh -p 2222 dev@localhost",
  sshKeyPath: null,
  sshPort: 2222,
  sshUser: "dev",
  targetDir: "/home/dev/app"
}

describe("project browser", () => {
  beforeEach(() => {
    getProjectItemByIdMock.mockReset()
    runCommandCaptureMock.mockReset()
    getProjectItemByIdMock.mockImplementation(() => Effect.succeed(projectItem))
    runCommandCaptureMock.mockImplementation((command: { readonly args: ReadonlyArray<string> }) =>
      command.args[0] === "inspect"
        ? Effect.succeed("browser-container-id\ttrue\trunning")
        : Effect.succeed("Browser started")
    )
  })

  it.effect("starts or reuses the Rust browser sidecar from the project container", () =>
    Effect.gen(function*(_) {
      const browser = yield* _(startProjectBrowserSession(projectId, "http://127.0.0.1:3334"))

      expect(browser).toMatchObject({
        containerName: browserContainerName,
        projectId,
        status: "running"
      })
      expect(runCommandCaptureMock).toHaveBeenCalledWith(
        {
          args: [
            "exec",
            projectContainerName,
            "docker-git-browser-connection",
            "start",
            "--project",
            projectContainerName,
            "--network",
            `container:${projectContainerName}`
          ],
          command: "docker",
          cwd: projectDir
        },
        [0],
        expect.any(Function)
      )
      expect(runCommandCaptureMock).toHaveBeenCalledWith(
        {
          args: [
            "exec",
            browserContainerName,
            "bash",
            "-lc",
            expect.stringMatching(/docker-git-chromium-launch[\s\S]*--hide-crash-restore-bubble[\s\S]*--display=:99/u)
          ],
          command: "docker",
          cwd: projectDir
        },
        [0],
        expect.any(Function)
      )
      expect(runCommandCaptureMock).toHaveBeenLastCalledWith(
        {
          args: ["inspect", "-f", "{{.Id}}\t{{.State.Running}}\t{{.State.Status}}", browserContainerName],
          command: "docker",
          cwd: projectDir
        },
        [0],
        expect.any(Function)
      )
    }).pipe(Effect.provide(NodeContext.layer)))

  it.effect("returns a conflict when the project container cannot launch the browser helper", () =>
    Effect.gen(function*(_) {
      runCommandCaptureMock.mockImplementationOnce(() =>
        Effect.fail(new CommandFailedError({ command: "docker exec docker-git-browser-connection start", exitCode: 127 }))
      )

      const result = yield* _(Effect.either(startProjectBrowserSession(projectId, "http://127.0.0.1:3334")))

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ApiConflictError)
        expect(result.left.message).toContain("Playwright MCP is enabled")
      }
    }).pipe(Effect.provide(NodeContext.layer)))

  it.effect("restarts the browser container after repairing the sidecar supervisor config", () =>
    Effect.gen(function*(_) {
      runCommandCaptureMock.mockImplementation((command: { readonly args: ReadonlyArray<string> }) => {
        if (command.args[0] === "inspect") {
          return Effect.succeed("browser-container-id\ttrue\trunning")
        }
        if (command.args[0] === "exec" && command.args[1] === browserContainerName) {
          return Effect.succeed("changed\n")
        }
        return Effect.succeed("Browser started")
      })

      const browser = yield* _(startProjectBrowserSession(projectId, "http://127.0.0.1:3334"))

      expect(browser.status).toBe("running")
      expect(runCommandCaptureMock).toHaveBeenCalledWith(
        {
          args: ["restart", browserContainerName],
          command: "docker",
          cwd: projectDir
        },
        [0],
        expect.any(Function)
      )
    }).pipe(Effect.provide(NodeContext.layer)))
})
