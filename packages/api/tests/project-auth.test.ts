import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Scope from "effect/Scope"
import fc from "fast-check"
import { vi } from "vitest"

import type { ProjectDetails } from "../src/api/contracts.js"

const grokOidcAuthScope = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828"
const grokLegacyAuthScope = "https://accounts.x.ai/sign-in"

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

const runGrokApiKeyConnectCase = (apiKey: string) =>
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
      yield* _(fs.writeFileString(path.join(grokDefaultAuth, ".api-key"), apiKey))
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
      const result = yield* _(
        withProjectsRoot(
          projectsRoot,
          service.runProjectAuthFlow(project, {
            flow: "ProjectGrokConnect",
            label: "default"
          })
        ).pipe(
          Effect.match({
            onFailure: (error) => ({ _tag: "failure" as const, errorTag: error._tag }),
            onSuccess: (snapshot) => ({ _tag: "success" as const, activeGrokLabel: snapshot.activeGrokLabel })
          })
        )
      )
      const envText = yield* _(fs.readFileString(envProjectPath))

      return { result, envText }
    })
  )

describe("project auth service", () => {
  it.effect("counts only credential-bearing project auth accounts", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const authRoot = path.join(projectsRoot, ".orch", "auth")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const projectDir = path.join(projectsRoot, "org", "repo")
        const envGlobalPath = path.join(envDir, "global.env")
        const envProjectPath = path.join(projectDir, ".env")
        const project = buildProjectDetails(projectDir, envProjectPath, envGlobalPath)

        yield* _(fs.makeDirectory(path.join(authRoot, "claude", "empty"), { recursive: true }))
        yield* _(fs.makeDirectory(path.join(authRoot, "gemini", "empty"), { recursive: true }))
        yield* _(fs.makeDirectory(path.join(authRoot, "grok", "empty", ".grok"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "grok", "empty", ".grok", "user-settings.json"), "{\"sandboxMode\":\"off\"}\n"))

        yield* _(fs.makeDirectory(path.join(authRoot, "claude", "live"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "claude", "live", ".credentials.json"), "{}\n"))
        yield* _(fs.makeDirectory(path.join(authRoot, "gemini", "live", ".gemini"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "gemini", "live", ".gemini", "oauth-tokens.json"), "{}\n"))
        yield* _(fs.makeDirectory(path.join(authRoot, "grok", "live"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(authRoot, "grok", "live", ".env"), "GROK_DEPLOYMENT_KEY='xai-deploy'\n"))
        yield* _(fs.makeDirectory(projectDir, { recursive: true }))
        yield* _(fs.makeDirectory(envDir, { recursive: true }))
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
        const snapshot = yield* _(withProjectsRoot(projectsRoot, service.readProjectAuthSnapshot(project)))

        expect(snapshot.claudeAuthEntries).toBe(1)
        expect(snapshot.geminiAuthEntries).toBe(1)
        expect(snapshot.grokAuthEntries).toBe(1)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("requires real Gemini credentials before connecting a project", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const envDir = path.join(projectsRoot, ".orch", "env")
        const geminiDefaultAuth = path.join(projectsRoot, ".orch", "auth", "gemini", "default")
        const projectDir = path.join(projectsRoot, "org", "repo")
        const envGlobalPath = path.join(envDir, "global.env")
        const envProjectPath = path.join(projectDir, ".env")
        const project = buildProjectDetails(projectDir, envProjectPath, envGlobalPath)

        yield* _(fs.makeDirectory(geminiDefaultAuth, { recursive: true }))
        yield* _(fs.makeDirectory(projectDir, { recursive: true }))
        yield* _(fs.makeDirectory(envDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(geminiDefaultAuth, ".api-key"), "  \n"))
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
        const emptyApiKeyFailure = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGeminiConnect",
              label: "default"
            }).pipe(Effect.flip)
          )
        )

        expect(emptyApiKeyFailure._tag).toBe("ApiBadRequestError")
        expect(yield* _(fs.readFileString(envProjectPath))).not.toContain("GEMINI_AUTH_LABEL=default")

        yield* _(fs.remove(path.join(geminiDefaultAuth, ".api-key")))
        yield* _(fs.makeDirectory(path.join(geminiDefaultAuth, ".gemini"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(geminiDefaultAuth, ".gemini", "oauth_creds.json"), "{\"access_token\":\"test\"}\n"))

        const snapshot = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGeminiConnect",
              label: "default"
            })
          )
        )

        expect(snapshot.activeGeminiLabel).toBe("default")
        expect(snapshot.geminiAuthEntries).toBe(1)
        expect(yield* _(fs.readFileString(envProjectPath))).toContain("GEMINI_AUTH_LABEL=default")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("preserves Grok project API-key connect invariants", () =>
    Effect.tryPromise({
      catch: (error) => error,
      try: () =>
        fc.assert(
          fc.asyncProperty(
            fc.oneof(fc.string(), fc.constant(""), fc.constant(" "), fc.constant("\t\n")),
            (apiKey) =>
              Effect.runPromise(
                runGrokApiKeyConnectCase(apiKey).pipe(
                  Effect.provide(NodeContext.layer),
                  Effect.map(({ result, envText }) => {
                    if (apiKey.trim().length === 0) {
                      expect(result._tag).toBe("failure")
                      if (result._tag === "failure") {
                        expect(result.errorTag).toBe("ApiBadRequestError")
                      }
                      expect(envText).not.toContain("GROK_AUTH_LABEL=default")
                      return
                    }

                    expect(result._tag).toBe("success")
                    if (result._tag === "success") {
                      expect(result.activeGrokLabel).toBe("default")
                    }
                    expect(envText).toContain("GROK_AUTH_LABEL=default")
                  })
                )
              )
          ),
          { numRuns: 20 }
        )
    }))

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
        expect(failure.message).toContain("Grok credentials")
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

        yield* _(fs.writeFileString(envProjectPath, "# project env\n"))
        yield* _(fs.remove(path.join(grokDefaultAuth, ".api-key")))
        yield* _(fs.makeDirectory(path.join(grokDefaultAuth, ".grok"), { recursive: true }))
        yield* _(
          fs.writeFileString(
            path.join(grokDefaultAuth, ".grok", "auth.json"),
            `${JSON.stringify({ [grokOidcAuthScope]: { key: "xai-oauth" } })}\n`
          )
        )

        const oauthSnapshot = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGrokConnect",
              label: "default"
            })
          )
        )

        expect(oauthSnapshot.activeGrokLabel).toBe("default")
        expect(yield* _(fs.readFileString(envProjectPath))).toContain("GROK_AUTH_LABEL=default")

        yield* _(fs.writeFileString(envProjectPath, "# project env\n"))
        yield* _(
          fs.writeFileString(
            path.join(grokDefaultAuth, ".grok", "auth.json"),
            `${JSON.stringify({ [grokLegacyAuthScope]: { key: "xai-legacy" } })}\n`
          )
        )

        const legacyOauthSnapshot = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGrokConnect",
              label: "default"
            })
          )
        )

        expect(legacyOauthSnapshot.activeGrokLabel).toBe("default")
        expect(yield* _(fs.readFileString(envProjectPath))).toContain("GROK_AUTH_LABEL=default")

        yield* _(fs.writeFileString(envProjectPath, "# project env\n"))
        yield* _(fs.writeFileString(path.join(grokDefaultAuth, ".grok", "auth.json"), "{\"scope\":{\"key\":\"xai-oauth\"}}\n"))

        const arbitraryAuthJsonFailure = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGrokConnect",
              label: "default"
            }).pipe(Effect.flip)
          )
        )

        expect(arbitraryAuthJsonFailure._tag).toBe("ApiBadRequestError")
        expect(yield* _(fs.readFileString(envProjectPath))).not.toContain("GROK_AUTH_LABEL=default")

        yield* _(fs.writeFileString(envProjectPath, "# project env\n"))
        yield* _(fs.remove(path.join(grokDefaultAuth, ".grok"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(grokDefaultAuth, ".env"), "GROK_DEPLOYMENT_KEY='xai-deploy'\n"))

        const envSnapshot = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGrokConnect",
              label: "default"
            })
          )
        )

        expect(envSnapshot.activeGrokLabel).toBe("default")
        expect(yield* _(fs.readFileString(envProjectPath))).toContain("GROK_AUTH_LABEL=default")

        yield* _(fs.writeFileString(envProjectPath, "# project env\n"))
        yield* _(fs.remove(path.join(grokDefaultAuth, ".env")))
        yield* _(fs.makeDirectory(path.join(grokDefaultAuth, ".grok"), { recursive: true }))
        yield* _(
          fs.writeFileString(
            path.join(grokDefaultAuth, ".grok", "user-settings.json"),
            "{\"oauth\":{},\"telemetry\":{\"token\":\"not-oauth\"}}\n"
          )
        )

        const falsePositiveFailure = yield* _(
          withProjectsRoot(
            projectsRoot,
            service.runProjectAuthFlow(project, {
              flow: "ProjectGrokConnect",
              label: "default"
            }).pipe(Effect.flip)
          )
        )

        expect(falsePositiveFailure._tag).toBe("ApiBadRequestError")
        expect(yield* _(fs.readFileString(envProjectPath))).not.toContain("GROK_AUTH_LABEL=default")
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
