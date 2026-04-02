import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import type { Command } from "../../src/lib/core/domain.js"

const ensureControllerReadyMock = vi.hoisted(() => vi.fn(() => Effect.void))
const runMenuCallMock = vi.hoisted(() => vi.fn(() => {}))

const menuCommand: Extract<Command, { readonly _tag: "Menu" }> = { _tag: "Menu" }

vi.mock("../../src/docker-git/cli/read-command.js", () => ({
  readCommand: Effect.succeed(menuCommand)
}))

vi.mock("../../src/docker-git/controller.js", () => ({
  ensureControllerReady: ensureControllerReadyMock
}))

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
