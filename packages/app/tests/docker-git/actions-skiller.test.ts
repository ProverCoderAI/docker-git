import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import { openSkillerApp } from "../../src/web/actions-skiller.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const openSkillerMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/api.js", () => ({
  openSkiller: openSkillerMock
}))

describe("web Skiller actions", () => {
  it.effect("opens Skiller through the docker-git API", () =>
    Effect.gen(function*(_) {
      openSkillerMock.mockImplementation(() =>
        Effect.succeed({
          alreadyRunning: false,
          logPath: "/home/dev/.docker-git/logs/skiller.log",
          ok: true,
          pid: 1234,
          startedAtIso: "2026-05-09T17:30:00.000Z"
        })
      )
      const { context, setMessage } = makeBrowserActionContext()

      openSkillerApp(context)

      yield* _(waitForAssertion(() => {
        expect(openSkillerMock).toHaveBeenCalledTimes(1)
      }))
      yield* _(waitForAssertion(() => {
        expect(setMessage).toHaveBeenCalledWith(
          "Skiller launch started (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log"
        )
      }))
      expect(context.setBusyLabel).toHaveBeenCalledWith("Opening Skiller")
      expect(context.setBusyLabel).toHaveBeenLastCalledWith(null)
    }))
})
