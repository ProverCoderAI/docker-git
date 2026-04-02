import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

const ensureControllerReadyMock = vi.hoisted(() => vi.fn(() => Effect.void))
const runMenuCallMock = vi.hoisted(() => vi.fn(() => undefined))

vi.mock("../../src/docker-git/cli/read-command.js", () => ({
  readCommand: Effect.succeed({ _tag: "Menu" } as const)
}))

vi.mock("../../src/docker-git/controller.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/docker-git/controller.js")>(
    "../../src/docker-git/controller.js"
  )

  return {
    ...actual,
    ensureControllerReady: ensureControllerReadyMock
  }
})

vi.mock("../../src/docker-git/menu.js", () => ({
  runMenu: Effect.sync(() => {
    runMenuCallMock()
  })
}))

describe("program menu dispatch", () => {
  beforeEach(() => {
    ensureControllerReadyMock.mockReset()
    ensureControllerReadyMock.mockImplementation(() => Effect.void)
    runMenuCallMock.mockReset()
    process.exitCode = 0
  })

  it.effect("routes menu through controller bootstrap instead of unsupported-command path", () =>
    Effect.gen(function*(_) {
      const { program } = yield* _(Effect.promise(() => import("../../src/docker-git/program.js")))

      yield* _(program.pipe(Effect.provide(NodeContext.layer)))

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(runMenuCallMock).toHaveBeenCalledTimes(1)
      expect(process.exitCode ?? 0).toBe(0)
    }))
})
