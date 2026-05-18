import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Scope from "effect/Scope"
import { vi } from "vitest"

import { githubRepoAccessMessage } from "@effect-template/lib/usecases/github-token-preflight"
import { gitlabRepoAccessMessage } from "@effect-template/lib/usecases/gitlab-token-preflight"

import { ApiAuthRequiredError } from "../src/api/errors.js"
import {
  ensureGithubAuthForCreate,
  ensureGitlabAuthForCreate,
  importCodexAuth,
  logoutCodexAuth,
  logoutGrokAuth,
  readCodexAuthStatus,
  readGrokAuthStatus,
  readGitlabAuthStatus,
  readGithubAuthStatus
} from "../src/services/auth.js"
import { createProjectFromRequest } from "../src/services/projects.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Exclude<R, Scope.Scope>> =>
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

const resolveFetchUrl = (input: Parameters<typeof globalThis.fetch>[0]): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url

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
            return
          }
          process.env["DOCKER_GIT_PROJECTS_ROOT"] = previous
        })
    ).pipe(Effect.flatMap(() => effect))
  )

const withPatchedFetch = <A, E, R>(
  fetchImpl: typeof globalThis.fetch,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() => {
        const previous = globalThis.fetch
        globalThis.fetch = fetchImpl
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          globalThis.fetch = previous
        })
    ).pipe(Effect.flatMap(() => effect))
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

  it.effect("reads GitLab auth status from the controller env file", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const envPath = path.join(envDir, "global.env")

        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(envPath, "GITLAB_TOKEN=live-token\n"))

        const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
          Effect.runPromise(
            Effect.succeed(
              new Response(JSON.stringify({ username: "gitlab-user" }), {
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
              withPatchedFetch(fetchMock, readGitlabAuthStatus())
            )
          )
        )

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(status.summary).toBe("GitLab tokens (1):")
        expect(status.tokens).toHaveLength(1)
        expect(status.tokens[0]?.status).toBe("valid")
        expect(status.tokens[0]?.login).toBe("gitlab-user")
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

  it.effect("returns auth required for GitLab create when no token is stored", () =>
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
              ensureGitlabAuthForCreate({
                repoUrl: "https://gitlab.com/group/repo.git",
                gitTokenLabel: undefined,
                envGlobalPath: ".docker-git/.orch/env/global.env"
              }).pipe(Effect.flip)
            )
          )
        )

        expect(failure).toBeInstanceOf(ApiAuthRequiredError)
        if (failure instanceof ApiAuthRequiredError) {
          expect(failure.provider).toBe("gitlab")
          expect(failure.command).toBe("docker-git auth gitlab login")
        }
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("returns bad request when the selected GitLab token cannot access the repository", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const envPath = path.join(envDir, "global.env")
        const repoUrl = "https://gitlab.com/group/private-repo.git"
        const fetchMock = vi.fn<typeof globalThis.fetch>((input) => {
          const url = resolveFetchUrl(input)

          if (url === "https://gitlab.com/api/v4/user") {
            return Effect.runPromise(
              Effect.succeed(
                new Response(JSON.stringify({ username: "gitlab-user" }), {
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
        yield* _(fs.writeFileString(envPath, "GITLAB_TOKEN=live-token\n"))

        const failure = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              withPatchedFetch(
                fetchMock,
                ensureGitlabAuthForCreate({
                  repoUrl,
                  gitTokenLabel: undefined,
                  envGlobalPath: ".docker-git/.orch/env/global.env"
                }).pipe(Effect.flip)
              )
            )
          )
        )

        expect(failure._tag).toBe("ApiBadRequestError")
        if (failure._tag === "ApiBadRequestError") {
          expect(failure.message).toBe(gitlabRepoAccessMessage(repoUrl, true))
        }
        expect(fetchMock).toHaveBeenCalledTimes(3)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("imports Codex auth into the controller-owned auth directory", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const authDir = path.join(projectsRoot, ".orch", "auth", "codex")
        const idTokenPayload = Buffer.from(JSON.stringify({ email: "ci@example.com", exp: 4_102_444_800 }), "utf8")
          .toString("base64url")
        const authText = JSON.stringify({
          auth_mode: "oauth",
          tokens: {
            id_token: `header.${idTokenPayload}.signature`,
            access_token: "access",
            refresh_token: "refresh",
            account_id: "acc-123"
          }
        }, null, 2)

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
        expect(status.account).toBe("ci@example.com")
        expect(status.authPath).toBe(path.join(authDir, "auth.json"))
        expect(status.message).toBe("Codex auth imported into controller state (account: ci@example.com).")

        const fileText = yield* _(fs.readFileString(path.join(authDir, "auth.json")))
        expect(fileText).toContain('"refresh_token": "refresh"')

        const readStatus = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, readCodexAuthStatus())
          )
        )

        expect(readStatus.present).toBe(true)
        expect(readStatus.account).toBe("ci@example.com")
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
        expect(removed.account).toBeNull()
        expect(removed.label).toBe("team-a")
        expect(removed.authPath).toBe(path.join(labeledAuthDir, "auth.json"))
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("reads labeled Grok auth status from controller state", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const accountDir = path.join(projectsRoot, ".orch", "auth", "grok", "team-a")

        yield* _(fs.makeDirectory(accountDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(accountDir, ".api-key"), "xai-test-key\n"))

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, readGrokAuthStatus("team-a"))
          )
        )

        expect(status.connected).toBe(true)
        expect(status.label).toBe("team-a")
        expect(status.method).toBe("api-key")
        expect(status.authPath).toBe(accountDir)
        expect(status.message).toBe("Grok connected (team-a, api-key).")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("removes labeled Grok auth from controller state", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const accountDir = path.join(projectsRoot, ".orch", "auth", "grok", "team-a")

        yield* _(fs.makeDirectory(path.join(accountDir, ".grok"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(accountDir, ".api-key"), "xai-test-key\n"))
        yield* _(fs.writeFileString(path.join(accountDir, ".grok", "user-settings.json"), "{\"apiKey\":\"xai-test-key\"}\n"))

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, logoutGrokAuth({ label: "team-a" }))
          )
        )

        expect(status.connected).toBe(false)
        expect(status.label).toBe("team-a")
        expect(status.method).toBe("none")
        expect(status.authPath).toBe(accountDir)
        expect(status.message).toBe("Grok not connected (team-a).")
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
