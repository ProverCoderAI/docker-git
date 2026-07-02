import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import * as fc from "fast-check"

import {
  controllerBuildSkillerEnvKey,
  controllerComposeExtraFileEnvKey,
  controllerGpuModeEnvKey,
  prepareControllerRevision,
  resolveControllerComposeFiles
} from "../../src/docker-git/controller-compose.js"
import { controllerRevisionEnvKey } from "../../src/docker-git/controller-revision.js"
import { controllerDockerRuntimeEnvKey } from "../../src/docker-git/controller-runtime.js"
import type { TestCommandResult } from "./fixtures/command-executor.js"
import { commandExecutorLayer } from "./fixtures/command-executor.js"

export const expectedSkillerSubmoduleCommand =
  "git submodule update --init --checkout third_party/skiller-desktop-skills-manager"
export const skillerPackageRelativePath = "third_party/skiller-desktop-skills-manager/package.json"

export const recordedCommandExecutorLayer = (
  startedCommands: Array<string>,
  result: TestCommandResult
) =>
  commandExecutorLayer((command) => {
    startedCommands.push([command.command, ...command.args].join(" "))
    return result
  })

export const temporaryControllerRoot = Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  return yield* _(fs.makeTempDirectoryScoped({ prefix: "docker-git-controller-compose-" }))
})

export const writeRootFile = (
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

export const writeMinimalCompose = (rootDir: string) =>
  writeRootFile(rootDir, "docker-compose.yml", "services:\n  api:\n    image: docker-git-api\n")

export const writeMinimalIsolatedCompose = (rootDir: string) =>
  writeRootFile(rootDir, "docker-compose.isolated.yml", "services:\n  api:\n    volumes: !override []\n")

export const writeMinimalExtraCompose = (rootDir: string) =>
  writeRootFile(rootDir, "docker-compose.auth-claude-login.yml", "services:\n  api:\n    environment: {}\n")

export const writeSkillerPackage = (rootDir: string) =>
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

export const withControllerEnv = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
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

export type PreparedRevision = {
  readonly persistedRevision: string | undefined
  readonly revision: string
}

export type ControllerBuildSkillerFixtureMode = "0" | "1" | undefined
export type ControllerDockerRuntimeEnvFixtureMode = "host" | "isolated" | undefined

export type PrepareRevisionFixture = {
  readonly buildSkillerMode: ControllerBuildSkillerFixtureMode
  readonly includeSkillerPackage: boolean
}

const controllerBuildSkillerFixtureModeArbitrary = fc.constantFrom<ControllerBuildSkillerFixtureMode>(
  undefined,
  "0",
  "1"
)
export const controllerDockerRuntimeEnvFixtureModeArbitrary = fc.constantFrom<ControllerDockerRuntimeEnvFixtureMode>(
  undefined,
  "host",
  "isolated"
)
export const prepareRevisionFixtureArbitrary: fc.Arbitrary<PrepareRevisionFixture> = fc
  .record({
    buildSkillerMode: controllerBuildSkillerFixtureModeArbitrary,
    includeSkillerPackage: fc.boolean()
  })
  .filter(({ buildSkillerMode, includeSkillerPackage }) => buildSkillerMode === "0" || includeSkillerPackage)
export const controllerRevisionPattern = /^[a-f0-9]{16}-host-none-skiller[01]$/u

export const withMinimalControllerRoot = <A, E, R>(
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

export const prepareRevisionInTemporaryRoot = ({
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
          [controllerComposeExtraFileEnvKey, undefined],
          [controllerDockerRuntimeEnvKey, undefined],
          [controllerGpuModeEnvKey, undefined],
          [controllerRevisionEnvKey, undefined]
        ])
      )

      const revision = yield* _(prepareControllerRevision())
      return { persistedRevision: process.env[controllerRevisionEnvKey], revision }
    })
  ).pipe(Effect.provide(NodeContext.layer))

export const resolveComposeFilesInTemporaryRoot = (
  dockerRuntimeMode: ControllerDockerRuntimeEnvFixtureMode
) =>
  withMinimalControllerRoot((rootDir) =>
    Effect.gen(function*(_) {
      yield* _(writeMinimalIsolatedCompose(rootDir))
      yield* _(
        withControllerEnv([
          [controllerBuildSkillerEnvKey, "0"],
          [controllerComposeExtraFileEnvKey, undefined],
          [controllerDockerRuntimeEnvKey, dockerRuntimeMode],
          [controllerGpuModeEnvKey, undefined]
        ])
      )
      return yield* _(resolveControllerComposeFiles())
    })
  ).pipe(Effect.provide(NodeContext.layer))

export const assertControllerComposeProperty = <PropertyArgs>(property: fc.IAsyncProperty<PropertyArgs>) =>
  Effect.tryPromise({
    catch: (cause) => cause,
    try: () => fc.assert(property, { numRuns: 25 })
  })
