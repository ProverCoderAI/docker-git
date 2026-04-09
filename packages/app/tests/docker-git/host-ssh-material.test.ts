import { NodeContext } from "@effect/platform-node"
/* jscpd:ignore-start */
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, type Exit } from "effect"

import type { HostSshMaterial } from "../../src/docker-git/host-ssh-material.js"
import { resolveHostSshMaterial, resolveManagedHostSshMaterial } from "../../src/docker-git/host-ssh-material.js"
import type { CreateCommand } from "../../src/lib/core/domain.js"
import type { CommandFailedError } from "../../src/lib/shell/errors.js"

type HostSshMaterialError = PlatformError | CommandFailedError
type HostSshMaterialServices =
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | Path.Path

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, PlatformError | E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-host-ssh-material-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withResource = <A, E, R, T>(
  acquire: Effect.Effect<T, E, R>,
  use: (value: T) => Effect.Effect<A, E, R>,
  release: (value: T, exit: Exit.Exit<A, E>) => Effect.Effect<void, never, R>
) => Effect.acquireUseRelease(acquire, use, release)

const withPatchedEnv = <A, E, R>(
  patch: Readonly<Record<string, string | undefined>>,
  effect: Effect.Effect<A, E, R>
) =>
  withResource(
    Effect.sync(() => {
      const previous = new Map<string, string | undefined>()

      for (const [key, value] of Object.entries(patch)) {
        previous.set(key, process.env[key])

        if (value === undefined) {
          Reflect.deleteProperty(process.env, key)
          continue
        }

        process.env[key] = value
      }

      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of previous.entries()) {
          if (value === undefined) {
            Reflect.deleteProperty(process.env, key)
            continue
          }

          process.env[key] = value
        }
      })
  )

const withWorkingDirectory = <A, E, R>(
  cwd: string,
  effect: Effect.Effect<A, E, R>
) =>
  withResource(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(cwd)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.chdir(previous)
      })
  )

const runMaterialCase = (
  resolver: (
    workspaceDir: string,
    path: Path.Path,
    projectsRoot: string
  ) => Effect.Effect<HostSshMaterial, HostSshMaterialError, HostSshMaterialServices>,
  assert: (
    material: HostSshMaterial,
    fs: FileSystem.FileSystem,
    path: Path.Path,
    projectsRoot: string
  ) => Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>
): Effect.Effect<void, HostSshMaterialError> =>
  withTempDir((root) =>
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const path = yield* _(Path.Path)
      const workspaceDir = path.join(root, "workspace")
      const homeDir = path.join(root, "home")
      const projectsRoot = path.join(root, ".docker-git")

      yield* _(fs.makeDirectory(workspaceDir, { recursive: true }))
      yield* _(fs.makeDirectory(homeDir, { recursive: true }))

      const material = yield* _(
        withPatchedEnv(
          {
            HOME: homeDir,
            DOCKER_GIT_PROJECTS_ROOT: projectsRoot,
            DOCKER_GIT_AUTHORIZED_KEYS: undefined,
            DOCKER_GIT_SSH_KEY: undefined
          },
          withWorkingDirectory(workspaceDir, resolver(workspaceDir, path, projectsRoot))
        )
      )

      yield* _(assert(material, fs, path, projectsRoot))
    })
  ).pipe(Effect.provide(NodeContext.layer))

const assertManagedHostSshMaterial = (
  material: HostSshMaterial,
  fs: FileSystem.FileSystem,
  path: Path.Path,
  projectsRoot: string,
  checkPublicKey: boolean
) => {
  expect(material.privateKeyPath).toBe(path.join(projectsRoot, "dev_ssh_key"))
  expect(material.authorizedKeysContents).toContain("ssh-ed25519")

  return Effect.gen(function*(_) {
    expect(yield* _(fs.exists(material.privateKeyPath))).toBe(true)

    if (checkPublicKey) {
      expect(yield* _(fs.exists(`${material.privateKeyPath}.pub`))).toBe(true)
    }
  })
}

/* jscpd:ignore-start */
const makeCommand = (outDir: string, path: Path.Path): CreateCommand => ({
  _tag: "Create",
  config: {
    containerName: "dg-test",
    serviceName: "dg-test",
    sshUser: "dev",
    sshPort: 2222,
    repoUrl: "https://github.com/org/repo.git",
    repoRef: "main",
    skipGithubAuth: false,
    targetDir: "/home/dev/workspaces/org/repo",
    volumeName: "dg-test-home",
    dockerGitPath: path.join(outDir, ".docker-git"),
    authorizedKeysPath: "./.docker-git/authorized_keys",
    envGlobalPath: "./.orch/env/global.env",
    envProjectPath: "./.orch/env/project.env",
    codexAuthPath: "./.orch/auth/codex",
    codexSharedAuthPath: "./.orch/auth/codex-shared",
    codexHome: "/home/dev/.codex",
    geminiAuthPath: "./.docker-git/.orch/auth/gemini",
    geminiHome: "/home/dev/.gemini",
    dockerNetworkMode: "shared",
    dockerSharedNetworkName: "docker-git-shared",
    enableMcpPlaywright: false,
    bunVersion: "1.3.11"
  },
  outDir,
  runUp: true,
  openSsh: true,
  force: false,
  forceEnv: false,
  waitForClone: true
})
/* jscpd:ignore-end */

describe("host ssh material", () => {
  it.effect("creates a managed SSH keypair when no host key exists", () =>
    runMaterialCase(
      (workspaceDir, path, _projectsRoot) =>
        resolveHostSshMaterial(makeCommand(path.join(workspaceDir, "project"), path)),
      (material, fs, path, projectsRoot) => assertManagedHostSshMaterial(material, fs, path, projectsRoot, true)
    ))

  it.effect("resolves managed SSH material for existing projects without create-command overrides", () =>
    runMaterialCase(
      () => resolveManagedHostSshMaterial(),
      (material, fs, path, projectsRoot) => assertManagedHostSshMaterial(material, fs, path, projectsRoot, false)
    ))
})
