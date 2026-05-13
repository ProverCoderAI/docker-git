import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Scope from "effect/Scope"
import { vi } from "vitest"

import type { TemplateConfig } from "../../src/core/domain.js"
import {
  gitlabInvalidTokenMessage,
  gitlabRepoAccessMessage,
  resolveGitlabCloneAuthToken,
  validateGitlabCloneAuthTokenPreflight
} from "../../src/usecases/gitlab-token-preflight.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-gitlab-token-preflight-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withPatchedFetch = <A, E, R>(
  fetchImpl: typeof globalThis.fetch,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
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

const resolveFetchUrl = (input: Parameters<typeof globalThis.fetch>[0]): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url

const makeConfig = (root: string, path: Path.Path): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://gitlab.com/group/subgroup/repo.git",
  repoRef: "main",
  skipGithubAuth: false,
  targetDir: "/home/dev/workspaces/group/subgroup/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch/env/global.env"),
  envProjectPath: path.join(root, ".orch/env/project.env"),
  codexAuthPath: path.join(root, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  geminiAuthPath: path.join(root, ".orch/auth/gemini"),
  geminiHome: "/home/dev/.gemini",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: false,
  gpu: "none",
  bunVersion: "1.3.11"
})

describe("gitlab token preflight", () => {
  it("prefers the namespace-labeled token over the default token", () => {
    const envText = [
      "# docker-git env",
      "GITLAB_TOKEN=default-token",
      "GITLAB_TOKEN__GROUP=labeled-token",
      ""
    ].join("\n")

    const token = resolveGitlabCloneAuthToken(envText, {
      repoUrl: "https://gitlab.com/group/subgroup/repo.git",
      gitTokenLabel: undefined
    })

    expect(token).toBe("labeled-token")
  })

  it.effect("fails before clone when the selected GitLab token is invalid", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const config = makeConfig(root, path)
        const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
          Effect.runPromise(Effect.succeed(new Response(null, { status: 401 })))
        )

        yield* _(fs.makeDirectory(path.join(root, ".orch", "env"), { recursive: true }))
        yield* _(fs.writeFileString(config.envGlobalPath, "GITLAB_TOKEN=dead-token\n"))

        const error = yield* _(
          withPatchedFetch(
            fetchMock,
            validateGitlabCloneAuthTokenPreflight(config).pipe(Effect.flip)
          )
        )

        expect(error._tag).toBe("AuthError")
        expect(error.message).toBe(gitlabInvalidTokenMessage)
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("fails before clone when the selected GitLab token cannot access the repository", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const config = makeConfig(root, path)
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

        yield* _(fs.makeDirectory(path.join(root, ".orch", "env"), { recursive: true }))
        yield* _(fs.writeFileString(config.envGlobalPath, "GITLAB_TOKEN=live-token\n"))

        const error = yield* _(
          withPatchedFetch(
            fetchMock,
            validateGitlabCloneAuthTokenPreflight(config).pipe(Effect.flip)
          )
        )

        expect(error._tag).toBe("AuthError")
        expect(error.message).toBe(gitlabRepoAccessMessage(config.repoUrl, true))
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(resolveFetchUrl(fetchMock.mock.calls[1]![0])).toBe(
          "https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Frepo"
        )
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
