import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  authGitLogin,
  authGitLogout,
  authGitStatus,
  buildGitTokenKey,
  buildGitUserKey,
  gitHostFromKey,
  listGitConnections,
  normalizeGitHost
} from "../../src/usecases/auth-git.js"

// CHANGE: cover the generic per-host git auth usecase end to end
// WHY: issue #368 adds git connections to providers other than github/gitlab via token
// QUOTE(ТЗ): "реализовать возможность добавлять git подключения отличных от gitlab, github ... просто здавая токен"
// REF: issue-368
// SOURCE: n/a
// FORMAT THEOREM: forall host: login(host, token) then status() contains {host_key, token}
// PURITY: SHELL (filesystem-backed Effects) / CORE (pure helper assertions)
// EFFECT: Effect<..., AuthError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: env keys mirror the in-container credential helper host normalization; tokens never logged
// COMPLEXITY: O(n) where n = |env entries|

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-auth-git-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

describe("normalizeGitHost", () => {
  it("strips scheme, credentials and path, then upper-snake-cases the host", () => {
    expect(normalizeGitHost("https://git.example.com/group/repo.git")).toBe("GIT_EXAMPLE_COM")
    expect(normalizeGitHost("ssh://user@gitea.internal:2222/x")).toBe("GITEA_INTERNAL_2222")
    expect(normalizeGitHost("bitbucket.example.org")).toBe("BITBUCKET_EXAMPLE_ORG")
    expect(normalizeGitHost("  ")).toBe("")
    expect(normalizeGitHost(null)).toBe("")
  })
})

describe("buildGitTokenKey / buildGitUserKey", () => {
  it("derives the host-scoped env key, falling back to the global key for an empty host", () => {
    expect(buildGitTokenKey("git.example.com")).toBe("GIT_AUTH_TOKEN__GIT_EXAMPLE_COM")
    expect(buildGitUserKey("git.example.com")).toBe("GIT_AUTH_USER__GIT_EXAMPLE_COM")
    expect(buildGitTokenKey("")).toBe("GIT_AUTH_TOKEN")
    expect(buildGitUserKey("")).toBe("GIT_AUTH_USER")
  })
})

describe("gitHostFromKey", () => {
  it("recovers the host suffix from token/user keys and defaults otherwise", () => {
    expect(gitHostFromKey("GIT_AUTH_TOKEN__GIT_EXAMPLE_COM")).toBe("GIT_EXAMPLE_COM")
    expect(gitHostFromKey("GIT_AUTH_USER__GIT_EXAMPLE_COM")).toBe("GIT_EXAMPLE_COM")
    expect(gitHostFromKey("GIT_AUTH_TOKEN")).toBe("default")
  })
})

describe("listGitConnections", () => {
  it("pairs host tokens with their users and ignores blank tokens", () => {
    const envText = [
      "GIT_AUTH_TOKEN__GIT_EXAMPLE_COM=token-a",
      "GIT_AUTH_USER__GIT_EXAMPLE_COM=ci-user",
      "GIT_AUTH_TOKEN__EMPTY_HOST=",
      "GITHUB_TOKEN=should-be-ignored",
      ""
    ].join("\n")

    expect(listGitConnections(envText)).toEqual([
      { host: "GIT_EXAMPLE_COM", token: "token-a", user: "ci-user" }
    ])
  })
})

describe("auth git usecase", () => {
  it.effect("login persists a host-scoped token + user, status reads it, logout removes it", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const fs = yield* _(FileSystem.FileSystem)
        const envGlobalPath = path.join(root, ".orch", "env", "global.env")

        yield* _(
          authGitLogin({
            _tag: "AuthGitLogin",
            host: "git.example.com",
            token: "secret-token",
            user: "deploy-bot",
            envGlobalPath
          })
        )

        const afterLogin = yield* _(fs.readFileString(envGlobalPath))
        expect(afterLogin).toContain("GIT_AUTH_TOKEN__GIT_EXAMPLE_COM=secret-token")
        expect(afterLogin).toContain("GIT_AUTH_USER__GIT_EXAMPLE_COM=deploy-bot")

        const connections = yield* _(
          authGitStatus({ _tag: "AuthGitStatus", envGlobalPath })
        )
        expect(connections).toEqual([
          { host: "GIT_EXAMPLE_COM", token: "secret-token", user: "deploy-bot" }
        ])

        yield* _(
          authGitLogout({ _tag: "AuthGitLogout", host: "git.example.com", envGlobalPath })
        )

        const afterLogout = yield* _(fs.readFileString(envGlobalPath))
        expect(afterLogout).not.toContain("GIT_AUTH_TOKEN__GIT_EXAMPLE_COM")
        expect(afterLogout).not.toContain("GIT_AUTH_USER__GIT_EXAMPLE_COM")

        const empty = yield* _(authGitStatus({ _tag: "AuthGitStatus", envGlobalPath }))
        expect(empty).toEqual([])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("login defaults the HTTPS user to x-access-token when none is given", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const fs = yield* _(FileSystem.FileSystem)
        const envGlobalPath = path.join(root, ".orch", "env", "global.env")

        yield* _(
          authGitLogin({
            _tag: "AuthGitLogin",
            host: "gitea.internal",
            token: "t",
            user: null,
            envGlobalPath
          })
        )

        const text = yield* _(fs.readFileString(envGlobalPath))
        expect(text).toContain("GIT_AUTH_USER__GITEA_INTERNAL=x-access-token")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("login fails with a typed AuthError when the host is empty", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const envGlobalPath = path.join(root, ".orch", "env", "global.env")
        const result = yield* _(
          authGitLogin({
            _tag: "AuthGitLogin",
            host: "",
            token: "t",
            user: null,
            envGlobalPath
          }).pipe(Effect.either)
        )
        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("AuthError")
        }
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
