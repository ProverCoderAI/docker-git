import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Scope from "effect/Scope"

import type { ApiEvent } from "../src/api/contracts.js"
import { ApiConflictError, ApiInternalError } from "../src/api/errors.js"
import { resolveManagedAuthorizedKeysContents } from "../src/services/project-authorized-keys.js"
import { listProjectEventsSince } from "../src/services/events.js"
import { createProjectFromRequest, getProject, listProjects, seedAuthorizedKeysForCreate } from "../src/services/projects.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-api-projects-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withWorkingDirectory = <A, E, R>(
  cwd: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.cwd()
        process.chdir(cwd)
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          process.chdir(previous)
        })
    ).pipe(Effect.flatMap(() => effect))
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

const withEnvVar = <A, E, R>(
  key: string,
  value: string | undefined,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env[key]
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) {
            delete process.env[key]
          } else {
            process.env[key] = previous
          }
        })
    ).pipe(Effect.flatMap(() => effect))
  )

const realSleep = (milliseconds: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  }))

const waitForEvents = (
  projectId: string,
  predicate: (events: ReadonlyArray<ApiEvent>) => boolean,
  attempts: number
): Effect.Effect<ReadonlyArray<ApiEvent>> =>
  Effect.gen(function*(_) {
    const events = listProjectEventsSince(projectId, 0)
    if (predicate(events) || attempts <= 0) {
      return events
    }
    yield* _(realSleep(50))
    return yield* _(waitForEvents(projectId, predicate, attempts - 1))
  })

describe("projects service", () => {
  it.effect("seeds host SSH keys into the controller managed authorized_keys file", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const expectedDefaultPath = path.join(projectsRoot, "authorized_keys")
        const expectedProjectPath = path.join(projectsRoot, "org", "repo", "authorized_keys")
        const hostKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestHostKey docker-git@test"

        yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              seedAuthorizedKeysForCreate(".docker-git/org/repo", hostKey)
            )
          )
        )

        const defaultContents = yield* _(fs.readFileString(expectedDefaultPath))
        const projectContents = yield* _(fs.readFileString(expectedProjectPath))
        expect(defaultContents).toBe(`${hostKey}\n`)
        expect(projectContents).toBe(`${hostKey}\n`)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("normalizes managed dev ssh private key permissions to 0600", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const privateKeyPath = path.join(projectsRoot, "dev_ssh_key")
        const publicKeyPath = `${privateKeyPath}.pub`

        yield* _(fs.makeDirectory(projectsRoot, { recursive: true }))
        yield* _(fs.writeFileString(privateKeyPath, "PRIVATE KEY"))
        yield* _(fs.writeFileString(publicKeyPath, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest docker-git@test\n"))
        yield* _(fs.chmod(privateKeyPath, 0o644))

        yield* _(
          withEnvVar(
            "DOCKER_GIT_SSH_KEY",
            undefined,
            withProjectsRoot(
              projectsRoot,
              withWorkingDirectory(
                root,
                resolveManagedAuthorizedKeysContents()
              )
            )
          )
        )

        const info = yield* _(fs.stat(privateKeyPath))
        expect(Number(info.mode ?? 0) & 0o777).toBe(0o600)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("renders docker access failures for API create without leaking stack traces", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")

        const failure = yield* _(
          withProjectsRoot(
            projectsRoot,
            withEnvVar(
              "DOCKER_CLIENT_TIMEOUT",
              "1",
              withWorkingDirectory(
                root,
                withEnvVar(
                  "DOCKER_HOST",
                  "tcp://127.0.0.1:1",
                  createProjectFromRequest({
                    repoUrl: "https://example.com/org/repo.git",
                    skipGithubAuth: true
                  }).pipe(Effect.flip)
                )
              )
            )
          )
        )

        expect(failure).toBeInstanceOf(ApiInternalError)
        if (failure instanceof ApiInternalError) {
          expect(failure.message).toContain("Cannot connect to Docker daemon.")
          expect(failure.message).not.toContain("docker-daemon-access.js")
        }
      })
    ).pipe(Effect.provide(NodeContext.layer)), 15_000)

  it.effect("accepts async create and records realtime lifecycle events on the request project id", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const projectId = path.join(projectsRoot, "async", "realtime")

        yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              Effect.gen(function*(_) {
                const accepted = yield* _(
                  createProjectFromRequest({
                    repoUrl: "https://git.example.test/test-owner/realtime.git",
                    repoRef: "main",
                    outDir: projectId,
                    skipGithubAuth: true,
                    up: false,
                    async: true
                  })
                )

                expect(accepted).toMatchObject({
                  accepted: true,
                  projectId,
                  cursor: 0
                })

                const events = yield* _(
                  waitForEvents(projectId, (items) => items.some((event) => event.type === "project.created"), 20)
                )

                expect(events.map((event) => event.type)).toContain("project.deployment.status")
                expect(events.map((event) => event.type)).toContain("project.created")
                expect(events.find((event) => event.type === "project.deployment.status")?.payload).toMatchObject({
                  phase: "create",
                  message: "Project creation started"
                })
                expect(events.find((event) => event.type === "project.created")?.payload).toMatchObject({
                  projectId,
                  project: {
                    projectDir: projectId
                  }
                })
              })
            )
          )
        )
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("lists lightweight project summaries while getProject returns project details", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const projectId = path.join(projectsRoot, "test-owner", "db-only")

        yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              createProjectFromRequest({
                repoUrl: "https://git.example.test/test-owner/db-only.git",
                repoRef: "main",
                outDir: projectId,
                skipGithubAuth: true,
                up: false
              })
            )
          )
        )

        const projects = yield* _(
          withEnvVar(
            "DOCKER_HOST",
            "unix:///definitely-missing-docker.sock",
            withProjectsRoot(projectsRoot, withWorkingDirectory(root, listProjects()))
          )
        )
        const details = yield* _(
          withEnvVar(
            "DOCKER_HOST",
            "unix:///definitely-missing-docker.sock",
            withProjectsRoot(projectsRoot, withWorkingDirectory(root, getProject(projectId)))
          )
        )

        expect(projects).toHaveLength(1)
        expect(projects[0]).toMatchObject({
          id: projectId,
          status: "unknown",
          statusLabel: "unknown",
          sshSessions: 0,
          startedAtIso: null,
          startedAtEpochMs: null
        })
        expect(projects[0]).not.toHaveProperty("sshCommand")
        expect(projects[0]).not.toHaveProperty("authorizedKeysPath")
        expect(projects[0]).not.toHaveProperty("envGlobalPath")
        expect(projects[0]).not.toHaveProperty("codexHome")
        expect(details).toMatchObject({
          id: projectId,
          projectDir: projectId,
          status: "unknown",
          statusLabel: "unknown"
        })
        expect(details).toHaveProperty("sshCommand")
        expect(details).toHaveProperty("authorizedKeysPath")
        expect(details).toHaveProperty("envGlobalPath")
        expect(details).toHaveProperty("codexHome")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("lists persisted launch metadata from .docker-git without Docker access", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const projectId = path.join(projectsRoot, "test-owner", "launched")
        const startedAtIso = "2026-04-21T10:00:00.000Z"
        const startedAtEpochMs = Date.parse(startedAtIso)
        const statePath = path.join(projectId, ".orch", "state", "runtime.json")

        yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              createProjectFromRequest({
                repoUrl: "https://git.example.test/test-owner/launched.git",
                repoRef: "main",
                outDir: projectId,
                skipGithubAuth: true,
                up: false
              })
            )
          )
        )

        yield* _(fs.makeDirectory(path.dirname(statePath), { recursive: true }))
        yield* _(
          fs.writeFileString(
            statePath,
            `${JSON.stringify({
              schemaVersion: 1,
              lastStartedAtIso: startedAtIso,
              lastStartedAtEpochMs: startedAtEpochMs,
              lastStartAction: "up",
              lastKnownStatus: "running",
              updatedAtIso: "2026-04-21T10:00:01.000Z"
            }, null, 2)}\n`
          )
        )

        const projects = yield* _(
          withEnvVar(
            "DOCKER_HOST",
            "unix:///definitely-missing-docker.sock",
            withProjectsRoot(projectsRoot, withWorkingDirectory(root, listProjects()))
          )
        )

        expect(projects).toHaveLength(1)
        expect(projects[0]).toMatchObject({
          id: projectId,
          status: "running",
          statusLabel: "last known: running",
          sshSessions: 0,
          startedAtIso,
          startedAtEpochMs
        })
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("maps duplicate docker identities to API conflict for create", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")

        yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              createProjectFromRequest({
                repoUrl: "https://git.example.test/test-owner-a/openclaw_autodeployer.git",
                repoRef: "main",
                sshPort: "2237",
                skipGithubAuth: true,
                up: false
              })
            )
          )
        )

        const error = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              createProjectFromRequest({
                repoUrl: "https://git.example.test/test-owner-b/openclaw_autodeployer.git",
                repoRef: "main",
                sshPort: "2238",
                skipGithubAuth: true,
                up: false
              }).pipe(Effect.flip)
            )
          )
        )

        expect(error).toBeInstanceOf(ApiConflictError)
        if (error instanceof ApiConflictError) {
          expect(error.message).toContain("Docker identities are already owned")
          expect(error.message).toContain("dg-openclaw_autodeployer")
        }
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
