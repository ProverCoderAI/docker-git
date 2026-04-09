import { NodeContext } from "@effect/platform-node"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import { type CreateCommand, defaultTemplateConfig } from "@lib/core/domain"

import { DockerIdentityConflictError } from "../../src/lib/shell/errors.js"
import { createProject } from "../../src/lib/usecases/actions/create-project.js"
import type { ProjectStatus } from "../../src/lib/usecases/projects-core.js"

const resolveSshPortMock = vi.hoisted(() => vi.fn((config: CreateCommand["config"]) => Effect.succeed(config)))
const buildSshCommandMock = vi.hoisted(() => vi.fn(() => "ssh -p 2222 dev@localhost"))
const getContainerIpIfInsideContainerMock = vi.hoisted(() =>
  vi.fn(() => Effect.sync((): string | undefined => undefined))
)
const loadProjectIndexMock = vi.hoisted(() => vi.fn())
const loadProjectStatusMock = vi.hoisted(() => vi.fn())
const migrateProjectOrchLayoutMock = vi.hoisted(() => vi.fn(() => Effect.void))
const prepareProjectFilesMock = vi.hoisted(() => vi.fn(() => Effect.succeed([])))
const autoSyncStateMock = vi.hoisted(() => vi.fn(() => Effect.void))
const deleteDockerGitProjectMock = vi.hoisted(() => vi.fn(() => Effect.void))
const runDockerDownCleanupMock = vi.hoisted(() => vi.fn(() => Effect.void))
const runDockerUpIfNeededMock = vi.hoisted(() => vi.fn(() => Effect.void))

vi.mock("../../src/lib/usecases/actions/ports.js", () => ({
  resolveSshPort: resolveSshPortMock
}))

vi.mock("../../src/lib/usecases/projects-core.js", () => ({
  buildSshCommand: buildSshCommandMock,
  getContainerIpIfInsideContainer: getContainerIpIfInsideContainerMock,
  loadProjectIndex: loadProjectIndexMock,
  loadProjectStatus: loadProjectStatusMock
}))

vi.mock("../../src/lib/usecases/actions/prepare-files.js", () => ({
  migrateProjectOrchLayout: migrateProjectOrchLayoutMock,
  prepareProjectFiles: prepareProjectFilesMock
}))

vi.mock("../../src/lib/usecases/state-repo.js", () => ({
  autoSyncState: autoSyncStateMock
}))

vi.mock("../../src/lib/usecases/projects-delete.js", () => ({
  deleteDockerGitProject: deleteDockerGitProjectMock
}))

vi.mock("../../src/lib/usecases/actions/docker-up.js", () => ({
  runDockerDownCleanup: runDockerDownCleanupMock,
  runDockerUpIfNeeded: runDockerUpIfNeededMock
}))

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, PlatformError | E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-identity-conflict-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const makeTemplate = (
  root: string,
  overrides: Partial<CreateCommand["config"]> = {}
): CreateCommand["config"] => ({
  ...defaultTemplateConfig,
  containerName: "dg-test",
  serviceName: "dg-test",
  volumeName: "dg-test-home",
  repoUrl: "https://git.example.test/test-owner-a/repo.git",
  repoRef: "main",
  targetDir: "/home/dev/org/repo",
  dockerGitPath: `${root}/.docker-git`,
  authorizedKeysPath: `${root}/authorized_keys`,
  envGlobalPath: `${root}/.orch/env/global.env`,
  envProjectPath: `${root}/.orch/env/project.env`,
  codexAuthPath: `${root}/.orch/auth/codex`,
  codexSharedAuthPath: `${root}/.orch/auth/codex-shared`,
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: false,
  ...overrides
})

const makeStatus = (
  projectDir: string,
  root: string,
  overrides: Partial<CreateCommand["config"]> = {}
): ProjectStatus => ({
  projectDir,
  config: {
    schemaVersion: 1,
    template: makeTemplate(root, overrides)
  }
})

const makeCommand = (
  root: string,
  outDir: string,
  force: boolean
): CreateCommand => ({
  _tag: "Create",
  config: makeTemplate(root),
  outDir,
  runUp: false,
  openSsh: false,
  force,
  forceEnv: false,
  waitForClone: false
})

const makeConflictContext = (
  root: string,
  path: Path.Path,
  force: boolean
) => {
  const outDir = path.join(root, "candidate")
  const existingDir = path.join(root, "existing")
  return {
    outDir,
    existingDir,
    existingConfigPath: path.join(existingDir, "docker-git.json"),
    command: makeCommand(root, outDir, force)
  }
}

const mockProjectIndex = (
  root: string,
  path: Path.Path,
  configPaths: ReadonlyArray<string>
): void => {
  loadProjectIndexMock.mockReturnValue(
    Effect.succeed({
      projectsRoot: path.join(root, ".docker-git"),
      configPaths
    })
  )
}

describe("createProject docker identity guard", () => {
  beforeEach(() => {
    loadProjectIndexMock.mockReset()
    loadProjectStatusMock.mockReset()
    resolveSshPortMock.mockReset()
    migrateProjectOrchLayoutMock.mockReset()
    prepareProjectFilesMock.mockReset()
    autoSyncStateMock.mockReset()
    deleteDockerGitProjectMock.mockReset()
    runDockerUpIfNeededMock.mockReset()
    runDockerDownCleanupMock.mockReset()
  })

  it.effect("fails when another project already uses the same Docker identity", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const { command, existingConfigPath, existingDir, outDir } = makeConflictContext(root, path, false)

        mockProjectIndex(root, path, [existingConfigPath])
        loadProjectStatusMock.mockImplementation((configPath: string) =>
          Effect.succeed(
            makeStatus(
              existingDir,
              root,
              configPath === existingConfigPath
                ? {}
                : {
                  containerName: "dg-test-other",
                  serviceName: "dg-test-other",
                  volumeName: "dg-test-other-home"
                }
            )
          )
        )

        const error = yield* _(createProject(command).pipe(Effect.flip))

        expect(error).toBeInstanceOf(DockerIdentityConflictError)
        if (error instanceof DockerIdentityConflictError) {
          expect(error.projectDir).toBe(outDir)
          expect(error.conflicts).toEqual([
            { conflictingProjectDir: existingDir, kind: "containerName", name: "dg-test" },
            { conflictingProjectDir: existingDir, kind: "serviceName", name: "dg-test" },
            { conflictingProjectDir: existingDir, kind: "volumeName", name: "dg-test-home" },
            { conflictingProjectDir: existingDir, kind: "bootstrapVolumeName", name: "dg-test-home-bootstrap" }
          ])
        }
        expect(prepareProjectFilesMock).not.toHaveBeenCalled()
        expect(deleteDockerGitProjectMock).not.toHaveBeenCalled()
        expect(runDockerUpIfNeededMock).not.toHaveBeenCalled()
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("force replaces the conflicting project before recreating", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const { command, existingConfigPath, existingDir } = makeConflictContext(root, path, true)

        mockProjectIndex(root, path, [existingConfigPath])
        loadProjectStatusMock.mockReturnValue(
          Effect.succeed(makeStatus(existingDir, root))
        )

        yield* _(createProject(command))

        expect(deleteDockerGitProjectMock).toHaveBeenCalledTimes(1)
        expect(deleteDockerGitProjectMock).toHaveBeenCalledWith({
          projectDir: existingDir,
          repoUrl: "https://git.example.test/test-owner-a/repo.git",
          containerName: "dg-test",
          serviceName: "dg-test"
        })
        expect(prepareProjectFilesMock).toHaveBeenCalledTimes(1)
        expect(runDockerUpIfNeededMock).toHaveBeenCalledTimes(1)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("allows the same projectDir to be recreated with --force", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "candidate")
        const configPath = path.join(outDir, "docker-git.json")
        const command = makeCommand(root, outDir, true)

        mockProjectIndex(root, path, [configPath])
        loadProjectStatusMock.mockReturnValue(
          Effect.succeed(makeStatus(outDir, root))
        )

        yield* _(createProject(command))

        expect(prepareProjectFilesMock).toHaveBeenCalledTimes(1)
        expect(deleteDockerGitProjectMock).not.toHaveBeenCalled()
        expect(migrateProjectOrchLayoutMock).toHaveBeenCalledTimes(1)
        expect(runDockerUpIfNeededMock).toHaveBeenCalledTimes(1)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
