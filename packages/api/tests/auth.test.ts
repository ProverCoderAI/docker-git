import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import { githubRepoAccessMessage } from "@effect-template/lib/usecases/github-token-preflight"

import { ApiAuthRequiredError } from "../src/api/errors.js"
import {
  ensureGithubAuthForCreate,
  importCodexAuth,
  logoutCodexAuth,
  readCodexAuthStatus,
  readGithubAuthStatus
} from "../src/services/auth.js"
import { createProjectFromRequest } from "../src/services/projects.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-api-auth-"
        })
      )
      return yield* _(use(tempDir))
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

const resolveFetchUrl = (input: Parameters<typeof globalThis.fetch>[0]): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url

const withProjectsRoot = <A, E, R>(
  projectsRoot: string,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env["DOCKER_GIT_PROJECTS_ROOT"]
      process.env["DOCKER_GIT_PROJECTS_ROOT"] = projectsRoot
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
          return
        }
        process.env["DOCKER_GIT_PROJECTS_ROOT"] = previous
      })
  )

const withPatchedFetch = <A, E, R>(
  fetchImpl: typeof globalThis.fetch,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.fetch
      globalThis.fetch = fetchImpl
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        globalThis.fetch = previous
      })
  )

describe("api auth", () => {
  it.effect("returns auth required for GitHub create when no token is stored", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const envPath = path.join(envDir, "global.env")

        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(envPath, "# docker-git env\n"))

        const failure = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              createProjectFromRequest({
                repoUrl: "https://github.com/ProverCoderAI/docker-git",
                repoRef: "main",
                envGlobalPath: ".docker-git/.orch/env/global.env"
              }).pipe(Effect.flip)
            )
          )
        )

        expect(failure).toBeInstanceOf(ApiAuthRequiredError)
        if (failure instanceof ApiAuthRequiredError) {
          expect(failure.provider).toBe("github")
          expect(failure.command).toBe("docker-git auth github login --web")
        }
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("reads GitHub auth status from the controller env file", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const envPath = path.join(envDir, "global.env")

        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(envPath, "GITHUB_TOKEN=live-token\n"))

        const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
          Effect.runPromise(
            Effect.succeed(
              new Response(JSON.stringify({ login: "octocat" }), {
                status: 200,
                headers: {
                  "content-type": "application/json"
                }
              })
            )
          )
        )

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              withPatchedFetch(fetchMock, readGithubAuthStatus())
            )
          )
        )

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(status.summary).toBe("GitHub tokens (1):")
        expect(status.tokens).toHaveLength(1)
        expect(status.tokens[0]?.status).toBe("valid")
        expect(status.tokens[0]?.login).toBe("octocat")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("skips API GitHub auth gate when anonymous clone override is enabled", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const envPath = path.join(envDir, "global.env")

        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(envPath, "# docker-git env\n"))

        yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              ensureGithubAuthForCreate({
                repoUrl: "https://github.com/ProverCoderAI/docker-git",
                gitTokenLabel: undefined,
                skipGithubAuth: true,
                envGlobalPath: ".docker-git/.orch/env/global.env"
              })
            )
          )
        )
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("returns bad request when the selected GitHub token cannot access the repository", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const envPath = path.join(envDir, "global.env")
        const repoUrl = "https://github.com/TestOrganization123213/openclaw_autodeployer"
        const fetchMock = vi.fn<typeof globalThis.fetch>((input) => {
          const url = resolveFetchUrl(input)

          if (url === "https://api.github.com/user") {
            return Effect.runPromise(
              Effect.succeed(
                new Response(JSON.stringify({ login: "octocat" }), {
                  status: 200,
                  headers: {
                    "content-type": "application/json"
                  }
                })
              )
            )
          }

          return Effect.runPromise(Effect.succeed(new Response(null, { status: 404 })))
        })

        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(envPath, "GITHUB_TOKEN=live-token\n"))

        const failure = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              withPatchedFetch(
                fetchMock,
                ensureGithubAuthForCreate({
                  repoUrl,
                  gitTokenLabel: undefined,
                  skipGithubAuth: false,
                  envGlobalPath: ".docker-git/.orch/env/global.env"
                }).pipe(Effect.flip)
              )
            )
          )
        )

        expect(failure._tag).toBe("ApiBadRequestError")
        if (failure._tag === "ApiBadRequestError") {
          expect(failure.message).toBe(githubRepoAccessMessage(repoUrl, true))
        }
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("imports Codex auth into the controller-owned auth directory", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const authDir = path.join(projectsRoot, ".orch", "auth", "codex")
        const authText = JSON.stringify({ openai: { type: "oauth", refresh: "refresh", access: "access" } }, null, 2)

        yield* _(fs.makeDirectory(projectsRoot, { recursive: true }))

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              importCodexAuth({ authText })
            )
          )
        )

        expect(status.present).toBe(true)
        expect(status.authPath).toBe(path.join(authDir, "auth.json"))
        expect(status.message).toBe("Codex auth imported into controller state.")

        const fileText = yield* _(fs.readFileString(path.join(authDir, "auth.json")))
        expect(fileText).toContain('"refresh": "refresh"')

        const readStatus = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, readCodexAuthStatus())
          )
        )

        expect(readStatus.present).toBe(true)
        expect(readStatus.authPath).toBe(path.join(authDir, "auth.json"))
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("removes labeled Codex auth from controller state", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const labeledAuthDir = path.join(projectsRoot, ".orch", "auth", "codex", "team-a")
        const authText = JSON.stringify({ tokens: { access_token: "access", refresh_token: "refresh" } }, null, 2)

        yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              importCodexAuth({ label: "team-a", authText })
            )
          )
        )

        const removed = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, logoutCodexAuth({ label: "team-a" }))
          )
        )

        expect(removed.present).toBe(false)
        expect(removed.label).toBe("team-a")
        expect(removed.authPath).toBe(path.join(labeledAuthDir, "auth.json"))
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
