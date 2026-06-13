import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import { defaultTemplateConfig, isUnixUsername, type TemplateConfig } from "../../src/core/domain.js"
import { readProjectConfig } from "../../src/shell/config.js"

const makeTemplateConfig = (overrides: Partial<TemplateConfig> = {}): TemplateConfig => ({
  ...defaultTemplateConfig,
  containerName: "dg-test",
  serviceName: "dg-test",
  repoUrl: "https://github.com/org/repo.git",
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  authorizedKeysPath: "/tmp/authorized_keys",
  codexAuthPath: "/tmp/.orch/auth/codex",
  codexSharedAuthPath: "/tmp/.orch/auth/codex-shared",
  codexHome: "/home/dev/.codex",
  ...overrides
})

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-config-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const invalidPersistedSshUserArbitrary = fc.oneof(
  fc.constantFrom(
    "",
    " ",
    "1dev",
    "-dev",
    "Dev",
    "dev user",
    "dev;touch-pwned",
    "dev$(touch-pwned)",
    "dev`touch-pwned`",
    "dev/foo",
    "dev.foo",
    "dev:foo",
    "dev\nfoo"
  ),
  fc.string({ minLength: 33, maxLength: 96 }).filter((value) => !isUnixUsername(value))
)

describe("readProjectConfig", () => {
  it.effect("rejects persisted configs with unsafe sshUser values", () =>
    withTempDir((tempDir) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const configPath = path.join(tempDir, "docker-git.json")
        const config = {
          schemaVersion: 1,
          template: makeTemplateConfig({
            sshUser: "dev;touch-pwned"
          })
        }

        yield* _(fs.writeFileString(configPath, JSON.stringify(config)))

        const result = yield* _(Effect.either(readProjectConfig(tempDir)))

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("ConfigDecodeError")
          expect(result.left.message).toContain("template.sshUser must match")
        }
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it("generates only invalid persisted sshUser candidates", () => {
    fc.assert(
      fc.property(invalidPersistedSshUserArbitrary, (sshUser) => {
        expect(isUnixUsername(sshUser)).toBe(false)
      })
    )
  })

  it.effect("rejects generated persisted configs with unsafe sshUser values", () =>
    Effect.tryPromise({
      catch: (error) => error,
      try: () =>
        fc.assert(
          fc.asyncProperty(invalidPersistedSshUserArbitrary, (sshUser) =>
            Effect.runPromise(
              withTempDir((tempDir) =>
                Effect.gen(function*(_) {
                  const fs = yield* _(FileSystem.FileSystem)
                  const path = yield* _(Path.Path)
                  const configPath = path.join(tempDir, "docker-git.json")
                  const config = {
                    schemaVersion: 1,
                    template: makeTemplateConfig({ sshUser })
                  }

                  yield* _(fs.writeFileString(configPath, JSON.stringify(config)))

                  const result = yield* _(Effect.either(readProjectConfig(tempDir)))

                  expect(result._tag).toBe("Left")
                  if (result._tag === "Left") {
                    expect(result.left._tag).toBe("ConfigDecodeError")
                    expect(result.left.message).toContain("template.sshUser must match")
                  }
                })
              ).pipe(Effect.provide(NodeContext.layer))
            )
          ),
          { numRuns: 50 }
        )
    }))
})
