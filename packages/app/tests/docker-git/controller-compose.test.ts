import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import { resolveControllerRuntimeOverlayPath } from "../../src/docker-git/controller-compose-runtime.js"
import {
  controllerBuildSkillerEnvKey,
  controllerComposeProjectName,
  controllerGpuModeEnvKey,
  ensureSkillerSubmoduleInitialized,
  prepareControllerRevision,
  resolveControllerComposeFiles
} from "../../src/docker-git/controller-compose.js"
import { runCompose } from "../../src/docker-git/controller-docker.js"
import { controllerRevisionEnvKey } from "../../src/docker-git/controller-revision.js"
import { controllerDockerRuntimeEnvKey } from "../../src/docker-git/controller-runtime.js"
import type { TestCommandResult } from "./fixtures/command-executor.js"
import { commandExecutorLayer, emptyCommandResult } from "./fixtures/command-executor.js"

const expectedSkillerSubmoduleCommand =
  "git submodule update --init --checkout third_party/skiller-desktop-skills-manager"
const skillerPackageRelativePath = "third_party/skiller-desktop-skills-manager/package.json"

const recordedCommandExecutorLayer = (
  startedCommands: Array<string>,
  result: TestCommandResult
) =>
  commandExecutorLayer((command) => {
    startedCommands.push([command.command, ...command.args].join(" "))
    return result
  })

const temporaryControllerRoot = Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  return yield* _(fs.makeTempDirectoryScoped({ prefix: "docker-git-controller-compose-" }))
})

const writeRootFile = (
  rootDir: string,
  relativePath: string,
  contents: string
) =>
  Effect.all({
    fs: FileSystem.FileSystem,
    path: Path.Path
  }).pipe(
    Effect.flatMap(({ fs, path }) => {
      const absolutePath = path.join(rootDir, relativePath)
      return fs.makeDirectory(path.dirname(absolutePath), { recursive: true }).pipe(
        Effect.zipRight(fs.writeFileString(absolutePath, contents))
      )
    })
  )

const writeMinimalCompose = (rootDir: string) =>
  writeRootFile(rootDir, "docker-compose.yml", "services:\n  api:\n    image: docker-git-api\n")

const writeMinimalIsolatedCompose = (rootDir: string) =>
  writeRootFile(rootDir, "docker-compose.isolated.yml", "services:\n  api:\n    volumes: !override []\n")

const writeSkillerPackage = (rootDir: string) =>
  writeRootFile(rootDir, skillerPackageRelativePath, "{\"name\":\"skiller-desktop-skills-manager\"}\n")

const withWorkingDirectory = (nextCwd: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previousCwd = process.cwd()
      process.chdir(nextCwd)
      return previousCwd
    }),
    (previousCwd) =>
      Effect.sync(() => {
        process.chdir(previousCwd)
      })
  )

const setOptionalEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key)
    return
  }
  process.env[key] = value
}

const withControllerEnv = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previousEntries: Array<readonly [string, string | undefined]> = entries.map(([
        key
      ]) => [key, process.env[key]])
      for (const [key, value] of entries) {
        setOptionalEnv(key, value)
      }
      return previousEntries
    }),
    (previousEntries) =>
      Effect.sync(() => {
        for (const [key, value] of previousEntries) {
          setOptionalEnv(key, value)
        }
      })
  )

type PreparedRevision = {
  readonly persistedRevision: string | undefined
  readonly revision: string
}

type ControllerBuildSkillerFixtureMode = "0" | "1" | undefined
type ControllerDockerRuntimeEnvFixtureMode = "host" | "isolated" | undefined

type PrepareRevisionFixture = {
  readonly buildSkillerMode: ControllerBuildSkillerFixtureMode
  readonly includeSkillerPackage: boolean
}

const controllerBuildSkillerFixtureModeArbitrary = fc.constantFrom<ControllerBuildSkillerFixtureMode>(
  undefined,
  "0",
  "1"
)
const controllerDockerRuntimeEnvFixtureModeArbitrary = fc.constantFrom<ControllerDockerRuntimeEnvFixtureMode>(
  undefined,
  "host",
  "isolated"
)
const prepareRevisionFixtureArbitrary: fc.Arbitrary<PrepareRevisionFixture> = fc
  .record({
    buildSkillerMode: controllerBuildSkillerFixtureModeArbitrary,
    includeSkillerPackage: fc.boolean()
  })
  .filter(({ buildSkillerMode, includeSkillerPackage }) => buildSkillerMode === "0" || includeSkillerPackage)
const controllerRevisionPattern = /^[a-f0-9]{16}-host-none-skiller[01]$/u

const withMinimalControllerRoot = <A, E, R>(
  effect: (rootDir: string) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const rootDir = yield* _(temporaryControllerRoot)
      yield* _(writeMinimalCompose(rootDir))
      yield* _(withWorkingDirectory(rootDir))
      return yield* _(effect(rootDir))
    })
  )

const prepareRevisionInTemporaryRoot = ({
  buildSkillerMode,
  includeSkillerPackage
}: PrepareRevisionFixture) =>
  withMinimalControllerRoot((rootDir) =>
    Effect.gen(function*(_) {
      if (includeSkillerPackage) {
        yield* _(writeSkillerPackage(rootDir))
      }
      yield* _(
        withControllerEnv([
          [controllerBuildSkillerEnvKey, buildSkillerMode],
          [controllerDockerRuntimeEnvKey, undefined],
          [controllerGpuModeEnvKey, undefined],
          [controllerRevisionEnvKey, undefined]
        ])
      )

      const revision = yield* _(prepareControllerRevision())
      return { persistedRevision: process.env[controllerRevisionEnvKey], revision }
    })
  ).pipe(Effect.provide(NodeContext.layer))

const expectPreparedRevision = (prepared: PreparedRevision, pattern: RegExp): void => {
  expect(prepared.revision).toMatch(pattern)
  expect(prepared.persistedRevision).toBe(prepared.revision)
}

const expectedSkillerSuffixForMode = (buildSkillerMode: ControllerBuildSkillerFixtureMode): string =>
  buildSkillerMode === "0" ? "skiller0" : "skiller1"

const expectPreparedRevisionInvariants = (fixture: PrepareRevisionFixture, prepared: PreparedRevision): void => {
  expectPreparedRevision(prepared, controllerRevisionPattern)
  expect(prepared.revision.endsWith(expectedSkillerSuffixForMode(fixture.buildSkillerMode))).toBe(true)
}

const resolveComposeFilesInTemporaryRoot = (
  dockerRuntimeMode: ControllerDockerRuntimeEnvFixtureMode
) =>
  withMinimalControllerRoot((rootDir) =>
    Effect.gen(function*(_) {
      yield* _(writeMinimalIsolatedCompose(rootDir))
      yield* _(
        withControllerEnv([
          [controllerBuildSkillerEnvKey, "0"],
          [controllerDockerRuntimeEnvKey, dockerRuntimeMode],
          [controllerGpuModeEnvKey, undefined]
        ])
      )
      return yield* _(resolveControllerComposeFiles())
    })
  ).pipe(Effect.provide(NodeContext.layer))

const assertControllerComposeProperty = <PropertyArgs>(property: fc.IAsyncProperty<PropertyArgs>) =>
  Effect.tryPromise({
    catch: (cause) => cause,
    try: () => fc.assert(property, { numRuns: 25 })
  })

describe("controller compose preparation", () => {
  it.effect("runs controller compose under the stable controller project name", () => {
    const startedCommands: Array<string> = []

    return withMinimalControllerRoot(() =>
      Effect.gen(function*(_) {
        yield* _(
          withControllerEnv([
            [controllerBuildSkillerEnvKey, "0"],
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
