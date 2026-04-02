import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { CreateCommand } from "../../src/lib/core/domain.js"
import {
  resolveHostSshMaterial,
  resolveManagedHostSshMaterial
} from "../../src/docker-git/host-ssh-material.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
) =>
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

const withPatchedEnv = <A, E, R>(
  patch: Readonly<Record<string, string | undefined>>,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = new Map<string, string | undefined>()
      for (const [key, value] of Object.entries(patch)) {
        previous.set(key, process.env[key])
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of previous.entries()) {
          if (value === undefined) {
            delete process.env[key]
          } else {
            process.env[key] = value
          }
        }
      })
  )

const withWorkingDirectory = <A, E, R>(
  cwd: string,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
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
    pnpmVersion: "10.27.0"
  },
  outDir,
  runUp: true,
  openSsh: true,
  force: false,
  forceEnv: false,
  waitForClone: true
})

describe("host ssh material", () => {
  it.effect("creates a managed SSH keypair when no host key exists", () =>
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
            withWorkingDirectory(
              workspaceDir,
              resolveHostSshMaterial(makeCommand(path.join(workspaceDir, "project"), path))
            )
          )
        )

        expect(material.privateKeyPath).toBe(path.join(projectsRoot, "dev_ssh_key"))
        expect(material.authorizedKeysContents).toContain("ssh-ed25519")
        expect(yield* _(fs.exists(material.privateKeyPath))).toBe(true)
        expect(yield* _(fs.exists(`${material.privateKeyPath}.pub`))).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("resolves managed SSH material for existing projects without create-command overrides", () =>
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
            withWorkingDirectory(
              workspaceDir,
              resolveManagedHostSshMaterial()
            )
          )
        )

        expect(material.privateKeyPath).toBe(path.join(projectsRoot, "dev_ssh_key"))
        expect(material.authorizedKeysContents).toContain("ssh-ed25519")
        expect(yield* _(fs.exists(material.privateKeyPath))).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
