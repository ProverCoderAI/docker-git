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

const usageCases = [
  { argv: ["node", "main"], needle: "pnpm docker-git" as const },
  { argv: ["node", "main", "Alice"], needle: "Usage:" as const }
] as const

const runUsageCase = ({
  argv,
  needle
}: (typeof usageCases)[number]) =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const logSpy = yield* _(withLogSpy)
      yield* _(withArgv(argv))
      yield* _(pipe(program, Effect.provide(NodeContext.layer)))
      yield* _(
        Effect.sync(() => {
          expect(logSpy).toHaveBeenCalledTimes(1)
          expect(logSpy).toHaveBeenLastCalledWith(
            expect.stringContaining(needle)
          )
        })
      )
    })
  )

describe("main program", () => {
  it.effect("prints usage for invalid invocations", () =>
    pipe(
      Effect.forEach(usageCases, runUsageCase, { concurrency: 1 }),
      Effect.asVoid
    ))
})
