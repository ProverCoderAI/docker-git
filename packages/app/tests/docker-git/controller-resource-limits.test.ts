import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

const composeFiles: ReadonlyArray<string> = ["docker-compose.yml", "docker-compose.api.yml"]

const readComposeFile = (relativePath: string): Effect.Effect<string> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    return yield* _(fs.readFileString(path.join("..", "..", relativePath)))
  }).pipe(
    Effect.provide(NodeContext.layer),
    Effect.orDie
  )

describe("controller compose resource limits", () => {
  for (const composeFile of composeFiles) {
    describe(composeFile, () => {
      it.effect("caps controller CPU usage", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toMatch(/cpus: \$\{DOCKER_GIT_CONTROLLER_CPUS:-\d+(?:\.\d+)?\}/u)
        }))

      it.effect("caps controller memory and swap together", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toMatch(/mem_limit: \$\{DOCKER_GIT_CONTROLLER_MEMORY:-\d+[a-zA-Z]+\}/u)
          expect(contents).toMatch(/memswap_limit: \$\{DOCKER_GIT_CONTROLLER_MEMORY:-\d+[a-zA-Z]+\}/u)
        }))

      it.effect("caps controller PIDs to prevent fork bombs", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toMatch(/pids_limit: \$\{DOCKER_GIT_CONTROLLER_PIDS:-\d+\}/u)
        }))
    })
  }
})
