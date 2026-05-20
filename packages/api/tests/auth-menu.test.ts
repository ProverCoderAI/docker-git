import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Scope from "effect/Scope"
import { vi } from "vitest"

const grokOidcAuthScope = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-api-auth-menu-"
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

describe("auth menu service", () => {
  it.effect("counts only credential-bearing auth accounts", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const authRoot = path.join(projectsRoot, ".orch", "auth")
        const envDir = path.join(projectsRoot, ".orch", "env")

        yield* _(fs.makeDirectory(path.join(authRoot, "claude", "empty"), { recursive: true }))
        yield* _(fs.makeDirectory(path.join(authRoot, "codex", "empty"), { recursive: true }))
        yield* _(fs.makeDirectory(path.join(authRoot, "gemini", "empty"), { recursive: true }))
        yield* _(fs.makeDirectory(path.join(authRoot, "grok", "empty", ".grok"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "grok", "empty", ".grok", "user-settings.json"), "{\"sandboxMode\":\"off\"}\n"))
        yield* _(fs.makeDirectory(path.join(authRoot, "codex", ".image"), { recursive: true }))
        yield* _(fs.makeDirectory(path.join(authRoot, "grok", ".image"), { recursive: true }))

        yield* _(fs.makeDirectory(path.join(authRoot, "claude", "live"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "claude", "live", ".oauth-token"), "claude-oauth\n"))
        yield* _(fs.makeDirectory(path.join(authRoot, "codex"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "codex", "auth.json"), "{\"tokens\":{\"account_id\":\"default\"}}\n"))
        yield* _(fs.makeDirectory(path.join(authRoot, "codex", "work"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "codex", "work", "auth.json"), "{\"tokens\":{\"account_id\":\"work\"}}\n"))
        yield* _(fs.makeDirectory(path.join(authRoot, "gemini", "live"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "gemini", "live", ".api-key"), "gemini-key\n"))
        yield* _(fs.makeDirectory(path.join(authRoot, "grok", "live", ".grok"), { recursive: true }))
        yield* _(
          fs.writeFileString(
            path.join(authRoot, "grok", "live", ".grok", "auth.json"),
            `${JSON.stringify({ [grokOidcAuthScope]: { key: "xai-oauth" } })}\n`
          )
        )
        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(envDir, "global.env"), "# docker-git env\n"))

        const service = yield* _(
          withProjectsRoot(
            projectsRoot,
            Effect.gen(function*(_) {
              yield* _(Effect.sync(() => vi.resetModules()))
              return yield* _(Effect.promise(() => import("../src/services/auth-menu.js")))
            })
          )
        )
        const snapshot = yield* _(withProjectsRoot(projectsRoot, service.readAuthMenuSnapshot()))

        expect(snapshot.claudeAuthEntries).toBe(1)
        expect(snapshot.codexAuthEntries).toBe(2)
        expect(snapshot.geminiAuthEntries).toBe(1)
        expect(snapshot.grokAuthEntries).toBe(1)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
