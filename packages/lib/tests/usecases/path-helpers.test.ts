import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { defaultProjectsRoot, findAuthorizedKeysSource, findSshPrivateKey } from "../../src/usecases/path-helpers.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-path-helpers-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withPatchedEnv = <A, E, R>(
  patch: Readonly<Record<string, string | undefined>>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
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

describe("path helpers", () => {
  it.effect("uses USERPROFILE with Windows separators when HOME is absent", () =>
    withPatchedEnv(
      {
        HOME: undefined,
        USERPROFILE: "C:\\Users\\Dev\\",
        DOCKER_GIT_PROJECTS_ROOT: undefined
      },
      Effect.sync(() => {
        expect(defaultProjectsRoot("C:\\workspace")).toBe("C:\\Users\\Dev\\.docker-git")
      })
    ))

  it.effect("uses Unix root HOME without a double separator", () =>
    withPatchedEnv(
      {
        HOME: "/",
        USERPROFILE: undefined,
        DOCKER_GIT_PROJECTS_ROOT: undefined
      },
      Effect.sync(() => {
        expect(defaultProjectsRoot("/workspace")).toBe("/.docker-git")
      })
    ))

  it.effect("uses Windows drive root USERPROFILE without a double separator", () =>
    withPatchedEnv(
      {
        HOME: undefined,
        USERPROFILE: "C:\\",
        DOCKER_GIT_PROJECTS_ROOT: undefined
      },
      Effect.sync(() => {
        expect(defaultProjectsRoot("C:\\workspace")).toBe("C:\\.docker-git")
      })
    ))

  it.effect("expands Windows home-relative projects root overrides", () =>
    withPatchedEnv(
      {
        HOME: undefined,
        USERPROFILE: "C:\\Users\\Dev",
        DOCKER_GIT_PROJECTS_ROOT: "~\\.dg"
      },
      Effect.sync(() => {
        expect(defaultProjectsRoot("C:\\workspace")).toBe("C:\\Users\\Dev\\.dg")
      })
    ))

  it.effect("prefers the docker-git projects root public key over generic ~/.ssh keys", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, "shared-projects")
        const homeDir = path.join(root, "home")
        const workspaceDir = path.join(root, "workspace", "a", "b", "c", "d", "e", "f", "repo")
        const dockerGitKey = path.join(projectsRoot, "dev_ssh_key.pub")
        const sshFallback = path.join(homeDir, ".ssh", "id_ed25519.pub")

        yield* _(fs.makeDirectory(path.dirname(dockerGitKey), { recursive: true }))
        yield* _(fs.makeDirectory(path.dirname(sshFallback), { recursive: true }))
        yield* _(fs.makeDirectory(workspaceDir, { recursive: true }))
        yield* _(fs.writeFileString(dockerGitKey, "docker-git-public-key\n"))
        yield* _(fs.writeFileString(sshFallback, "generic-public-key\n"))

        const found = yield* _(
          withPatchedEnv(
            {
              HOME: homeDir,
              DOCKER_GIT_PROJECTS_ROOT: projectsRoot,
              DOCKER_GIT_AUTHORIZED_KEYS: undefined,
              DOCKER_GIT_SSH_KEY: undefined
            },
            findAuthorizedKeysSource(fs, path, workspaceDir)
          )
        )

        expect(found).toBe(dockerGitKey)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("prefers the docker-git projects root private key over generic ~/.ssh keys", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, "shared-projects")
        const homeDir = path.join(root, "home")
        const workspaceDir = path.join(root, "workspace", "repo")
        const dockerGitKey = path.join(projectsRoot, "dev_ssh_key")
        const sshFallback = path.join(homeDir, ".ssh", "id_ed25519")

        yield* _(fs.makeDirectory(path.dirname(dockerGitKey), { recursive: true }))
        yield* _(fs.makeDirectory(path.dirname(sshFallback), { recursive: true }))
        yield* _(fs.makeDirectory(workspaceDir, { recursive: true }))
        yield* _(fs.writeFileString(dockerGitKey, "docker-git-private-key\n"))
        yield* _(fs.writeFileString(sshFallback, "generic-private-key\n"))

        const found = yield* _(
          withPatchedEnv(
            {
              HOME: homeDir,
              DOCKER_GIT_PROJECTS_ROOT: projectsRoot,
              DOCKER_GIT_AUTHORIZED_KEYS: undefined,
              DOCKER_GIT_SSH_KEY: undefined
            },
            findSshPrivateKey(fs, path, workspaceDir)
          )
        )

        expect(found).toBe(dockerGitKey)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
