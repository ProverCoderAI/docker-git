import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import type { CreateCommand, TemplateConfig } from "../../src/core/domain.js"
import { createProject } from "../../src/usecases/actions/create-project.js"
import {
  githubInvalidTokenMessage,
  resolveGithubCloneAuthToken
} from "../../src/usecases/github-token-preflight.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-github-token-preflight-"
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

const makeCommand = (root: string, outDir: string, path: Path.Path): CreateCommand => {
  const template: TemplateConfig = {
    containerName: "dg-test",
    serviceName: "dg-test",
    sshUser: "dev",
    sshPort: 2222,
    repoUrl: "https://github.com/TelegramGPT/go-login-ozon.git",
    repoRef: "main",
    targetDir: "/home/dev/workspaces/telegramgpt/go-login-ozon",
    volumeName: "dg-test-home",
    dockerGitPath: path.join(root, ".docker-git"),
    authorizedKeysPath: path.join(root, "authorized_keys"),
    envGlobalPath: path.join(root, ".orch/env/global.env"),
    envProjectPath: path.join(root, ".orch/env/project.env"),
    codexAuthPath: path.join(root, ".orch/auth/codex"),
    codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
    codexHome: "/home/dev/.codex",
    dockerNetworkMode: "shared",
    dockerSharedNetworkName: "docker-git-shared",
    enableMcpPlaywright: false,
    pnpmVersion: "10.27.0"
  }

  return {
    _tag: "Create",
    config: template,
    outDir,
    runUp: false,
    openSsh: false,
    force: true,
    forceEnv: false,
    waitForClone: true
  }
}

describe("github token preflight", () => {
  it("prefers the owner-labeled token over the default token", () => {
    const envText = [
      "# docker-git env",
      "GITHUB_TOKEN=default-token",
      "GITHUB_TOKEN__TELEGRAMGPT=labeled-token",
      ""
    ].join("\n")

    const token = resolveGithubCloneAuthToken(envText, {
      repoUrl: "https://github.com/TelegramGPT/go-login-ozon.git",
      gitTokenLabel: undefined
    })

    expect(token).toBe("labeled-token")
  })

  it.effect("fails createProject before writing files when the selected GitHub token is invalid", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const command = makeCommand(root, outDir, path)
        const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
          Effect.runPromise(Effect.succeed(new Response(null, { status: 401 })))
        )

        yield* _(fs.makeDirectory(path.join(root, ".orch", "env"), { recursive: true }))
        yield* _(
          fs.writeFileString(
            command.config.envGlobalPath,
            [
              "# docker-git env",
              "GITHUB_TOKEN=dead-token",
              ""
            ].join("\n")
          )
        )

        const error = yield* _(
          withPatchedFetch(
            fetchMock,
            createProject(command).pipe(Effect.flip)
          )
        )

        expect(error._tag).toBe("AuthError")
        expect(error.message).toBe(githubInvalidTokenMessage)
        expect(fetchMock).toHaveBeenCalledTimes(1)

        const outDirExists = yield* _(fs.exists(outDir))
        expect(outDirExists).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
