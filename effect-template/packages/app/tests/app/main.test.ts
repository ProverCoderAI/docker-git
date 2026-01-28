import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, pipe } from "effect"
import { vi } from "vitest"

import { program } from "../../src/app/program.js"

const withLogSpy = Effect.acquireRelease(
  Effect.sync(() => vi.spyOn(console, "log").mockImplementation(() => {})),
  (spy) =>
    Effect.sync(() => {
      spy.mockRestore()
    })
)

const withArgv = (nextArgv: ReadonlyArray<string>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.argv
      process.argv = [...nextArgv]
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        process.argv = previous
      })
  )

describe("main program", () => {
  it.effect("logs default greeting when no args", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const logSpy = yield* _(withLogSpy)
        yield* _(withArgv(["node", "main"]))
        yield* _(pipe(program, Effect.provide(NodeContext.layer)))
        yield* _(Effect.sync(() => {
          expect(logSpy).toHaveBeenCalledTimes(1)
          expect(logSpy).toHaveBeenLastCalledWith("Hello from Effect!")
        }))
      })
    ))

  it.effect("logs named greeting when name is provided", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const logSpy = yield* _(withLogSpy)
        yield* _(withArgv(["node", "main", "Alice"]))
        yield* _(pipe(program, Effect.provide(NodeContext.layer)))
        yield* _(Effect.sync(() => {
          expect(logSpy).toHaveBeenCalledTimes(1)
          expect(logSpy).toHaveBeenLastCalledWith("Hello, Alice!")
        }))
      })
    ))
})
