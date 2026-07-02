import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import { resolveControllerRuntimeOverlayPath } from "../../src/docker-git/controller-compose-runtime.js"
import {
  controllerBuildSkillerEnvKey,
  controllerComposeExtraFileEnvKey,
  controllerComposeProjectName,
  controllerGpuModeEnvKey,
  ensureSkillerSubmoduleInitialized,
  resolveControllerComposeFiles
} from "../../src/docker-git/controller-compose.js"
import { runCompose } from "../../src/docker-git/controller-docker.js"
import { controllerDockerRuntimeEnvKey } from "../../src/docker-git/controller-runtime.js"
import {
  assertControllerComposeProperty,
  type ControllerBuildSkillerFixtureMode,
  controllerDockerRuntimeEnvFixtureModeArbitrary,
  controllerRevisionPattern,
  expectedSkillerSubmoduleCommand,
  type PreparedRevision,
  type PrepareRevisionFixture,
  prepareRevisionFixtureArbitrary,
  prepareRevisionInTemporaryRoot,
  recordedCommandExecutorLayer,
  resolveComposeFilesInTemporaryRoot,
  temporaryControllerRoot,
  withControllerEnv,
  withMinimalControllerRoot,
  writeMinimalExtraCompose,
  writeSkillerPackage
} from "./controller-compose-fixture.js"
import { emptyCommandResult } from "./fixtures/command-executor.js"

const expectPreparedRevision = (prepared: PreparedRevision, pattern: RegExp): void => {
  expect(prepared.revision).toMatch(pattern)
  expect(prepared.persistedRevision).toBe(prepared.revision)
}

const expectedSkillerSuffixForMode = (buildSkillerMode: ControllerBuildSkillerFixtureMode): string =>
  buildSkillerMode === "0" || buildSkillerMode === "false" ? "skiller0" : "skiller1"

const expectPreparedRevisionInvariants = (fixture: PrepareRevisionFixture, prepared: PreparedRevision): void => {
  expectPreparedRevision(prepared, controllerRevisionPattern)
  expect(prepared.revision.endsWith(expectedSkillerSuffixForMode(fixture.buildSkillerMode))).toBe(true)
}

describe("controller compose preparation", () => {
  it.effect("runs controller compose under the stable controller project name", () => {
    const startedCommands: Array<string> = []

    return withMinimalControllerRoot(() =>
      Effect.gen(function*(_) {
        yield* _(
          withControllerEnv([
            [controllerBuildSkillerEnvKey, "0"],
            [controllerComposeExtraFileEnvKey, undefined],
            [controllerDockerRuntimeEnvKey, undefined],
            [controllerGpuModeEnvKey, undefined]
          ])
        )
        const recordedExecutorLayer = recordedCommandExecutorLayer(startedCommands, emptyCommandResult)
        yield* _(
          runCompose(["up", "-d"]).pipe(
            Effect.provide(recordedExecutorLayer)
          )
        )

        const composeCommand = startedCommands.find((command) =>
          command.startsWith(`docker compose --project-name ${controllerComposeProjectName} -f `)
        )
        expect(composeCommand).toBeDefined()
        expect(composeCommand?.endsWith(" up -d")).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer))
  })

  it.effect("passes the verified extra compose overlay into controller compose commands", () => {
    const startedCommands: Array<string> = []

    return withMinimalControllerRoot((rootDir) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        yield* _(writeMinimalExtraCompose(rootDir))
        const extraComposePath = path.join(rootDir, "docker-compose.auth-claude-login.yml")
        yield* _(
          withControllerEnv([
            [controllerBuildSkillerEnvKey, "0"],
            [controllerComposeExtraFileEnvKey, extraComposePath],
            [controllerDockerRuntimeEnvKey, undefined],
            [controllerGpuModeEnvKey, undefined]
          ])
        )

        const composeFiles = yield* _(resolveControllerComposeFiles())
        expect(composeFiles.extraOverlayPath).toBe(extraComposePath)

        const recordedExecutorLayer = recordedCommandExecutorLayer(startedCommands, emptyCommandResult)
        yield* _(
          runCompose(["up", "-d"]).pipe(
            Effect.provide(recordedExecutorLayer)
          )
        )

        const composeCommand = startedCommands.find((command) =>
          command.startsWith(`docker compose --project-name ${controllerComposeProjectName} -f `)
        )
        expect(composeCommand).toBeDefined()
        expect(composeCommand).toContain(` -f ${extraComposePath} up -d`)
      })
    ).pipe(Effect.provide(NodeContext.layer))
  })

  it.effect("rejects extra compose overlay paths that are directories", () =>
    withMinimalControllerRoot((rootDir) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const extraComposePath = path.join(rootDir, "docker-compose.auth-claude-login.yml")
        yield* _(fs.makeDirectory(extraComposePath))
        yield* _(
          withControllerEnv([
            [controllerBuildSkillerEnvKey, "0"],
            [controllerComposeExtraFileEnvKey, extraComposePath],
            [controllerDockerRuntimeEnvKey, undefined],
            [controllerGpuModeEnvKey, undefined]
          ])
        )

        const error = yield* _(resolveControllerComposeFiles().pipe(Effect.flip))
        expect(error._tag).toBe("ControllerBootstrapError")
        expect(error.message).toContain("regular file")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("rejects GPU compose overlay paths that are directories", () =>
    withMinimalControllerRoot((rootDir) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const gpuComposePath = path.join(rootDir, "docker-compose.gpu.yml")
        yield* _(fs.makeDirectory(gpuComposePath))
        yield* _(
          withControllerEnv([
            [controllerBuildSkillerEnvKey, "0"],
            [controllerComposeExtraFileEnvKey, undefined],
            [controllerDockerRuntimeEnvKey, undefined],
            [controllerGpuModeEnvKey, "all"]
          ])
        )

        const error = yield* _(resolveControllerComposeFiles().pipe(Effect.flip))
        expect(error._tag).toBe("ControllerBootstrapError")
        expect(error.message).toContain("regular file")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not initialize the Skiller submodule when package metadata already exists", () => {
    const startedCommands: Array<string> = []

    return Effect.scoped(
      temporaryControllerRoot.pipe(
        Effect.tap(writeSkillerPackage),
        Effect.flatMap((rootDir) =>
          ensureSkillerSubmoduleInitialized(rootDir).pipe(
            Effect.provide(recordedCommandExecutorLayer(startedCommands, emptyCommandResult))
          )
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            expect(startedCommands).toEqual([])
          })
        )
      )
    ).pipe(Effect.provide(NodeContext.layer))
  })

  it.effect("reports a typed failure when submodule initialization cannot provide package metadata", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const rootDir = yield* _(temporaryControllerRoot)
        const startedCommands: Array<string> = []

        const submoduleFailureExecutorLayer = recordedCommandExecutorLayer(
          startedCommands,
          { exitCode: 128, stderr: "fatal: no submodule mapping found", stdout: "" }
        )
        const error = yield* _(
          ensureSkillerSubmoduleInitialized(rootDir).pipe(
            Effect.provide(submoduleFailureExecutorLayer),
            Effect.provide(NodeContext.layer),
            Effect.flip
          )
        )

        expect(error._tag).toBe("ControllerBootstrapError")
        expect(error.message).toContain(expectedSkillerSubmoduleCommand)
        expect(startedCommands).toEqual([expectedSkillerSubmoduleCommand])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("adds the isolated runtime overlay only for isolated controller mode", () =>
    assertControllerComposeProperty(
      fc.asyncProperty(controllerDockerRuntimeEnvFixtureModeArbitrary, (dockerRuntimeMode) =>
        Effect.runPromise(
          resolveComposeFilesInTemporaryRoot(dockerRuntimeMode).pipe(
            Effect.tap((files) =>
              Effect.sync(() => {
                if (dockerRuntimeMode === "isolated") {
                  expect(files.runtimeOverlayPath).toBeDefined()
                  expect(files.runtimeOverlayPath?.endsWith("docker-compose.isolated.yml")).toBe(true)
                  return
                }
                expect(files.runtimeOverlayPath).toBeNull()
              })
            ),
            Effect.asVoid
          )
        ))
    ))

  it.effect("rejects unsupported compose filename extensions for isolated controller mode", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const rootDir = yield* _(temporaryControllerRoot)
        const error = yield* _(
          resolveControllerRuntimeOverlayPath(path.join(rootDir, "docker-compose.json"), "isolated").pipe(Effect.flip)
        )
        expect(error._tag).toBe("ControllerBootstrapError")
        expect(error.message).toContain(".yml or .yaml")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("rejects isolated runtime overlay paths that are directories", () =>
    withMinimalControllerRoot((rootDir) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const runtimeComposePath = path.join(rootDir, "docker-compose.isolated.yml")
        yield* _(fs.remove(runtimeComposePath, { force: true }))
        yield* _(fs.makeDirectory(runtimeComposePath))
        yield* _(
          withControllerEnv([
            [controllerBuildSkillerEnvKey, "0"],
            [controllerComposeExtraFileEnvKey, undefined],
            [controllerDockerRuntimeEnvKey, "isolated"],
            [controllerGpuModeEnvKey, undefined]
          ])
        )

        const error = yield* _(resolveControllerComposeFiles().pipe(Effect.flip))
        expect(error._tag).toBe("ControllerBootstrapError")
        expect(error.message).toContain("regular file")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("prepares and persists host controller revisions for Skiller build modes", () =>
    assertControllerComposeProperty(
      fc.asyncProperty(prepareRevisionFixtureArbitrary, (fixture) =>
        Effect.runPromise(
          prepareRevisionInTemporaryRoot(fixture).pipe(
            Effect.tap((prepared) =>
              Effect.sync(() => {
                expectPreparedRevisionInvariants(fixture, prepared)
              })
            ),
            Effect.asVoid
          )
        ))
    ))
})
