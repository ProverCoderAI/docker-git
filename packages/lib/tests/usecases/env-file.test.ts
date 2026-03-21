import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { inspectComposeEnvText, sanitizeComposeEnvFile } from "../../src/usecases/env-file.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-env-file-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

describe("inspectComposeEnvText", () => {
  it("drops merge conflict markers and canonicalizes docker compose env assignments", () => {
    const input = [
      "# docker-git env",
      " export GITHUB_TOKEN = token-1 ",
      "<<<<<<< Updated upstream",
      "=======",
      ">>>>>>> Stashed changes",
      " CODEX_SHARE_AUTH = 1 ",
      ""
    ].join("\n")

    const inspected = inspectComposeEnvText(input)

    expect(inspected.invalidLines.map((line) => line.lineNumber)).toEqual([3, 4, 5])
    expect(inspected.sanitized).toBe([
      "# docker-git env",
      "GITHUB_TOKEN=token-1",
      "CODEX_SHARE_AUTH=1",
      ""
    ].join("\n"))
  })

  it.effect("sanitizes compose env files in place before docker compose reads them", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const envPath = path.join(root, "project.env")

        yield* _(
          fs.writeFileString(
            envPath,
            [
              "# docker-git env",
              " export GITHUB_TOKEN = token-1 ",
              "<<<<<<< Updated upstream",
              "BAD LINE",
              " CODEX_SHARE_AUTH = 1 ",
              ""
            ].join("\n")
          )
        )

        const invalidLines = yield* _(sanitizeComposeEnvFile(fs, envPath))
        const sanitized = yield* _(fs.readFileString(envPath))

        expect(invalidLines.map((line) => line.lineNumber)).toEqual([3, 4])
        expect(sanitized).toBe([
          "# docker-git env",
          "GITHUB_TOKEN=token-1",
          "CODEX_SHARE_AUTH=1",
          ""
        ].join("\n"))
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
