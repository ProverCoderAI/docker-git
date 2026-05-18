import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Scope from "effect/Scope"
import { vi } from "vitest"

import type { ProjectDetails } from "../src/api/contracts.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-api-project-auth-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withProjectsRoot = <A, E, R>(
  projectsRoot: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env["DOCKER_GIT_PROJECTS_ROOT"]
        process.env["DOCKER_GIT_PROJECTS_ROOT"] = projectsRoot
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) {
            delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
          } else {
            process.env["DOCKER_GIT_PROJECTS_ROOT"] = previous
          }
        })
    ).pipe(Effect.flatMap(() => effect))
  )

const buildProjectDetails = (projectDir: string, envProjectPath: string, envGlobalPath: string): ProjectDetails => ({
  id: projectDir,
  projectKey: "org/repo",
  displayName: "org/repo",
  repoUrl: "https://git.example.test/org/repo.git",
  repoRef: "main",
  containerName: "dg-project-auth-test",
  serviceName: "dg-project-auth-test",
  status: "stopped",
  statusLabel: "stopped",
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null,
  sshUser: "dev",
  sshPort: 2222,
  gpu: "none",
  targetDir: "/home/dev/app",
  projectDir,
  sshCommand: "ssh dev@localhost",
  authorizedKeysPath: `${projectDir}/authorized_keys`,
  authorizedKeysExists: false,
  envGlobalPath,
  envProjectPath,
  codexAuthPath: `${projectDir}/codex`,
  codexHome: "/home/dev/.codex"
})

describe("project auth service", () => {
  it.effect("requires a non-empty Grok .api-key before connecting an account", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const grokDefaultAuth = path.join(projectsRoot, ".orch", "auth", "grok", "default")
        const projectDir = path.join(projectsRoot, "org", "repo")
        const envGlobalPath = path.join(envDir, "global.env")
        const envProjectPath = path.join(projectDir, ".env")
        const project = buildProjectDetails(projectDir, envProjectPath, envGlobalPath)

        yield* _(fs.makeDirectory(grokDefaultAuth, { recursive: true }))
        yield* _(fs.makeDirectory(projectDir, { recursive: true }))
        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(grokDefaultAuth, ".api-key"), "  \n"))
        yield* _(fs.writeFileString(envGlobalPath, "# docker-git env\n"))
        yield* _(fs.writeFileString(envProjectPath, "# project env\n"))

        const service = yield* _(
          withProjectsRoot(
            projectsRoot,
            Effect.gen(function*(_) {
              yield* _(Effect.sync(() => vi.resetModules()))
              return yield* _(Effect.promise(() => import("../src/services/project-auth.js")))
            })
          )
        )
        const failure = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGrokConnect",
              label: "default"
            }).pipe(Effect.flip)
          )
        )

        expect(failure._tag).toBe("ApiBadRequestError")
        expect(failure.message).toContain("Grok CLI login not connected")
        expect(yield* _(fs.readFileString(envProjectPath))).not.toContain("GROK_AUTH_LABEL=default")

        yield* _(fs.writeFileString(path.join(grokDefaultAuth, ".api-key"), "live-token\n"))
        const snapshot = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGrokConnect",
              label: "default"
            })
          )
        )

        expect(snapshot.activeGrokLabel).toBe("default")
        expect(yield* _(fs.readFileString(envProjectPath))).toContain("GROK_AUTH_LABEL=default")
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
