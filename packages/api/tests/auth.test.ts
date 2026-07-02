import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Scope from "effect/Scope"
import fc from "fast-check"
import { vi } from "vitest"

import { githubRepoAccessMessage } from "@effect-template/lib/usecases/github-token-preflight"
import { gitlabRepoAccessMessage } from "@effect-template/lib/usecases/gitlab-token-preflight"

import { ApiAuthRequiredError } from "../src/api/errors.js"
import { isLoopbackRemoteAddress } from "../src/http.js"
import {
  ensureGithubAuthForCreate,
  ensureGitlabAuthForCreate,
  importCodexAuth,
  loginGitAuth,
  logoutCodexAuth,
  logoutGitAuth,
  logoutGrokAuth,
  readClaudeAuthStatus,
  readCodexAuthStatus,
  readGitAuthStatus,
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

const labelChars = ["a", "b", "c", "d", "e", "f", "0", "1", "2", "3", "-", "_"] as const
const claudeLabelArbitrary = fc.option(
  fc.array(fc.constantFrom(...labelChars), { minLength: 1, maxLength: 12 }).map((chars) => chars.join("")),
  { nil: null }
)
const claudeStatusScenarioArbitrary = fc.constantFrom("none", "oauth-token", "root-session", "nested-session")

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

  it.effect("reads labeled Claude OAuth status from controller state", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const accountDir = path.join(projectsRoot, ".orch", "auth", "claude", "team-a")

        yield* _(fs.makeDirectory(accountDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(accountDir, ".oauth-token"), "sk-ant-oat01-test\n"))
        yield* _(
          fs.writeFileString(
            path.join(accountDir, ".claude.json"),
            JSON.stringify({ oauthAccount: { emailAddress: "team@example.com", accountUuid: "acc-1" } }, null, 2)
          )
        )

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, readClaudeAuthStatus("team-a"))
          )
        )

        expect(status.connected).toBe(true)
        expect(status.label).toBe("team-a")
        expect(status.account).toBe("team@example.com")
        expect(status.method).toBe("oauth-token")
        expect(status.authPath).toBe(accountDir)
        expect(status.message).toBe("Claude connected (team-a, oauth-token, account: team@example.com).")
        expect(JSON.stringify(status)).not.toContain("sk-ant-oat01-test")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("reads labeled Claude root session credentials from controller state", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const accountDir = path.join(projectsRoot, ".orch", "auth", "claude", "team-a")

        yield* _(fs.makeDirectory(accountDir, { recursive: true }))
        yield* _(
          fs.writeFileString(
            path.join(accountDir, ".credentials.json"),
            JSON.stringify({ claudeAiOauth: { displayName: "Team Claude" } }, null, 2)
          )
        )

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, readClaudeAuthStatus("team-a"))
          )
        )

        expect(status.connected).toBe(true)
        expect(status.label).toBe("team-a")
        expect(status.account).toBe("Team Claude")
        expect(status.method).toBe("claude-ai-session")
        expect(status.authPath).toBe(accountDir)
        expect(status.message).toBe("Claude connected (team-a, claude-ai-session, account: Team Claude).")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("reads labeled Claude nested session credentials from controller state", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const accountDir = path.join(projectsRoot, ".orch", "auth", "claude", "team-a")
        const nestedDir = path.join(accountDir, ".claude")

        yield* _(fs.makeDirectory(nestedDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(nestedDir, ".credentials.json"), "{\"session\":\"ok\"}\n"))

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, readClaudeAuthStatus("team-a"))
          )
        )

        expect(status.connected).toBe(true)
        expect(status.label).toBe("team-a")
        expect(status.account).toBeNull()
        expect(status.method).toBe("claude-ai-session")
        expect(status.authPath).toBe(accountDir)
        expect(status.message).toBe("Claude connected (team-a, claude-ai-session, account unavailable).")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("reports missing default Claude auth from controller state", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const accountDir = path.join(projectsRoot, ".orch", "auth", "claude", "default")

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, readClaudeAuthStatus(null))
          )
        )

        expect(status.connected).toBe(false)
        expect(status.label).toBe("default")
        expect(status.account).toBeNull()
        expect(status.method).toBe("none")
        expect(status.authPath).toBe(accountDir)
        expect(status.message).toBe("Claude not connected (default).")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("preserves Claude auth status invariants for generated labels and methods", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        let caseIndex = 0
        yield* _(
          Effect.promise(() =>
            fc.assert(
              fc.asyncProperty(
                claudeLabelArbitrary,
                claudeStatusScenarioArbitrary,
                (label, scenario) => {
                  const localCaseIndex = caseIndex++
                  return Effect.runPromise(
                    Effect.gen(function*(_) {
                      const fs = yield* _(FileSystem.FileSystem)
                      const path = yield* _(Path.Path)
                      const caseRoot = path.join(root, `claude-status-${localCaseIndex}`)
                      const projectsRoot = path.join(caseRoot, ".docker-git")
                      const accountLabel = label ?? "default"
                      const accountDir = path.join(projectsRoot, ".orch", "auth", "claude", accountLabel)
                      const token = `sk-ant-oat01-property-${localCaseIndex}`

                      yield* _(fs.makeDirectory(caseRoot, { recursive: true }))
                      if (scenario !== "none") {
                        yield* _(fs.makeDirectory(accountDir, { recursive: true }))
                      }
                      if (scenario === "oauth-token") {
                        yield* _(fs.writeFileString(path.join(accountDir, ".oauth-token"), `${token}\n`))
                        yield* _(
                          fs.writeFileString(
                            path.join(accountDir, ".claude.json"),
                            JSON.stringify({ oauthAccount: { emailAddress: `team-${localCaseIndex}@example.test` } })
                          )
                        )
                      }
                      if (scenario === "root-session") {
                        yield* _(
                          fs.writeFileString(
                            path.join(accountDir, ".credentials.json"),
                            JSON.stringify({ claudeAiOauth: { displayName: `Team ${localCaseIndex}` } })
                          )
                        )
                      }
                      if (scenario === "nested-session") {
                        const nestedDir = path.join(accountDir, ".claude")
                        yield* _(fs.makeDirectory(nestedDir, { recursive: true }))
                        yield* _(fs.writeFileString(path.join(nestedDir, ".credentials.json"), "{\"session\":\"ok\"}\n"))
                      }

                      const status = yield* _(
                        withProjectsRoot(
                          projectsRoot,
                          withWorkingDirectory(caseRoot, readClaudeAuthStatus(label))
                        )
                      )
                      const statusByNormalizedLabel = yield* _(
                        withProjectsRoot(
                          projectsRoot,
                          withWorkingDirectory(caseRoot, readClaudeAuthStatus(status.label))
                        )
                      )

                      return { status, statusByNormalizedLabel, token }
                    }).pipe(
                      Effect.tap((result) =>
                        Effect.sync(() => {
                          expect(result.status.connected).toBe(result.status.method !== "none")
                          expect(result.statusByNormalizedLabel.label).toBe(result.status.label)
                          expect(JSON.stringify(result.status)).not.toContain(result.token)
                        })
                      ),
                      Effect.asVoid,
                      Effect.provide(NodeContext.layer)
                    )
                  )
                }
              ),
              { numRuns: 25 }
            )
          )
        )
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("classifies auth status loopback clients without accepting non-loopback remotes", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          fc.constantFrom("127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "[::1]:3334"),
          (address) => {
            expect(isLoopbackRemoteAddress(address)).toBe(true)
          }
        )
      )
      fc.assert(
        fc.property(
          fc.constantFrom("", "0.0.0.0", "10.0.0.2", "172.18.0.3", "192.168.1.10", "example.test"),
          (address) => {
            expect(isLoopbackRemoteAddress(address)).toBe(false)
          }
        )
      )
    }))

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

  // CHANGE: cover the generic per-host git auth login/status/logout endpoints
  // WHY: issue #368 wants git connections to providers other than github/gitlab via token
  // QUOTE(ТЗ): "реализовать возможность добавлять git подключения отличных от gitlab, github ... просто здавая токен"
  // REF: issue-368
  // SOURCE: https://git-scm.com/docs/gitcredentials
  // FORMAT THEOREM: login(host, token) then status() reports {host_key, user} and NEVER the token
  // PURITY: SHELL (filesystem-backed Effects)
  // EFFECT: Effect<GitAuthStatus, ApiBadRequestError | PlatformError, FileSystem | Path>
  // INVARIANT: token values are never serialized into the status payload
  // COMPLEXITY: O(n) where n = |env entries|
  it.effect("logs in, lists and logs out a generic per-host git connection without leaking the token", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const envPath = path.join(envDir, "global.env")

        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(envPath, "# docker-git env\n"))

        const afterLogin = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              loginGitAuth({ host: "git.example.com", token: "secret-token", user: "deploy-bot" })
            )
          )
        )

        expect(afterLogin.summary).toBe("Git connections (1):")
        expect(afterLogin.connections).toEqual([{ host: "GIT_EXAMPLE_COM", user: "deploy-bot" }])
        // SECURITY: the status payload must never carry token values
        expect(JSON.stringify(afterLogin)).not.toContain("secret-token")

        const envText = yield* _(fs.readFileString(envPath))
        expect(envText).toContain("GIT_AUTH_TOKEN__GIT_EXAMPLE_COM=secret-token")
        expect(envText).toContain("GIT_AUTH_USER__GIT_EXAMPLE_COM=deploy-bot")

        const status = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(root, readGitAuthStatus())
          )
        )
        expect(status.connections).toEqual([{ host: "GIT_EXAMPLE_COM", user: "deploy-bot" }])

        const afterLogout = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              logoutGitAuth({ host: "git.example.com" })
            )
          )
        )
        expect(afterLogout.summary).toBe("No generic git connections.")
        expect(afterLogout.connections).toEqual([])

        const finalEnv = yield* _(fs.readFileString(envPath))
        expect(finalEnv).not.toContain("GIT_AUTH_TOKEN__GIT_EXAMPLE_COM")
        expect(finalEnv).not.toContain("GIT_AUTH_USER__GIT_EXAMPLE_COM")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("rejects generic git login when host or token is missing", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const envPath = path.join(envDir, "global.env")

        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(envPath, "# docker-git env\n"))

        const missingHost = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              loginGitAuth({ host: "  ", token: "t", user: null }).pipe(Effect.flip)
            )
          )
        )
        expect(missingHost._tag).toBe("ApiBadRequestError")

        const missingToken = yield* _(
          withProjectsRoot(
            projectsRoot,
            withWorkingDirectory(
              root,
              loginGitAuth({ host: "git.example.com", token: "  ", user: null }).pipe(Effect.flip)
            )
          )
        )
        expect(missingToken._tag).toBe("ApiBadRequestError")
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
