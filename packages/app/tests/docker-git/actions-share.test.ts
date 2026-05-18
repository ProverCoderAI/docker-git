import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { afterEach, beforeEach, vi } from "vitest"

import {
  copyPanelShareTunnelUrl,
  refreshPanelCloudflareTunnel,
  startPanelShareTunnel,
  stopPanelShareTunnel
} from "../../src/web/actions-share.js"
import type {
  loadPanelCloudflareTunnel,
  PanelCloudflareTunnelSession,
  startPanelCloudflareTunnel,
  stopPanelCloudflareTunnel
} from "../../src/web/api.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const loadPanelCloudflareTunnelMock = vi.hoisted(() => vi.fn<typeof loadPanelCloudflareTunnel>())
const startPanelCloudflareTunnelMock = vi.hoisted(() => vi.fn<typeof startPanelCloudflareTunnel>())
const stopPanelCloudflareTunnelMock = vi.hoisted(() => vi.fn<typeof stopPanelCloudflareTunnel>())

vi.mock("../../src/web/api.js", () => ({
  loadPanelCloudflareTunnel: loadPanelCloudflareTunnelMock,
  startPanelCloudflareTunnel: startPanelCloudflareTunnelMock,
  stopPanelCloudflareTunnel: stopPanelCloudflareTunnelMock
}))

const runningTunnel: PanelCloudflareTunnelSession = {
  error: null,
  id: "tunnel-1",
  logTail: ["https://shared-panel.trycloudflare.com"],
  panelUrl: "http://localhost:4174/",
  publicUrl: "https://shared-panel.trycloudflare.com",
  startedAt: "2026-05-18T00:00:00.000Z",
  status: "running",
  stoppedAt: null
}

type ClipboardWriteText = typeof globalThis.navigator.clipboard.writeText

const labelCharacters = "abcdefghijklmnopqrstuvwxyz0123456789"

const labelCharacter = (value: number): string => labelCharacters[value] ?? "a"

const hostnameLabelArbitrary = fc.array(fc.integer({ min: 0, max: 35 }), {
  maxLength: 24,
  minLength: 1
}).map((values) => values.map((value) => labelCharacter(value)).join(""))

const tryCloudflareOriginArbitrary = hostnameLabelArbitrary.map((label) => `https://${label}.trycloudflare.com`)

const stoppedAtArbitrary = fc.integer({ max: 86_399_999, min: 0 }).map((milliseconds) =>
  new Date(Date.UTC(2026, 4, 18, 0, 0, 0, milliseconds)).toISOString()
)

const clipboardImplementation = (succeeds: boolean): ClipboardWriteText => () =>
  succeeds ? Effect.runPromise(Effect.void) : Effect.runPromise(Effect.fail(new Error("denied")))

const copyTunnelWithClipboard = (implementation: ClipboardWriteText) => {
  const writeText = vi.fn(implementation)
  vi.stubGlobal("navigator", { clipboard: { writeText } })
  const { context, setMessage } = makeBrowserActionContext()

  copyPanelShareTunnelUrl(context, runningTunnel.publicUrl ?? "")

  return { setMessage, writeText }
}

const expectCopyTunnelMessage = (
  implementation: ClipboardWriteText,
  expectedMessage: string
) =>
  Effect.gen(function*(_) {
    const { setMessage, writeText } = copyTunnelWithClipboard(implementation)

    yield* _(waitForAssertion(() => {
      expect(writeText).toHaveBeenCalledWith("https://shared-panel.trycloudflare.com")
      expect(setMessage).toHaveBeenLastCalledWith(expectedMessage)
    }))
  })

const expectTryCloudflareOriginBlocked = (origin: string): void => {
  startPanelCloudflareTunnelMock.mockClear()
  vi.stubGlobal("location", { origin })
  const { context, setMessage } = makeBrowserActionContext()

  startPanelShareTunnel(context)

  expect(startPanelCloudflareTunnelMock).not.toHaveBeenCalled()
  expect(setMessage).toHaveBeenLastCalledWith("Open docker-git locally before starting a new Cloudflare tunnel.")
}

const expectStoppedTunnelContext = (
  stoppedTunnel: PanelCloudflareTunnelSession
) =>
  Effect.gen(function*(_) {
    stopPanelCloudflareTunnelMock.mockReset()
    stopPanelCloudflareTunnelMock.mockImplementation(() => Effect.succeed(stoppedTunnel))
    const { context, setMessage } = makeBrowserActionContext()

    stopPanelShareTunnel(context)

    yield* _(waitForAssertion(() => {
      expect(stopPanelCloudflareTunnelMock).toHaveBeenCalledTimes(1)
    }))
    expect(context.setPanelCloudflareTunnel).toHaveBeenLastCalledWith(stoppedTunnel)
    expect(setMessage).toHaveBeenLastCalledWith("Cloudflare tunnel stopped.")
  })

const assertAsyncFastCheck = <Ts>(
  property: fc.IAsyncProperty<Ts>,
  params?: fc.Parameters<Ts>
) =>
  Effect.tryPromise({
    catch: (error) => error,
    try: () => fc.assert(property, params)
  })

describe("web share actions", () => {
  beforeEach(() => {
    loadPanelCloudflareTunnelMock.mockReset()
    startPanelCloudflareTunnelMock.mockReset()
    stopPanelCloudflareTunnelMock.mockReset()
    vi.stubGlobal("location", {
      origin: "http://localhost:4174"
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect("starts a panel Cloudflare tunnel for the current local origin", () =>
    Effect.gen(function*(_) {
      startPanelCloudflareTunnelMock.mockImplementation(() => Effect.succeed(runningTunnel))
      const { context, setMessage } = makeBrowserActionContext()

      startPanelShareTunnel(context)

      yield* _(waitForAssertion(() => {
        expect(startPanelCloudflareTunnelMock).toHaveBeenCalledWith("http://localhost:4174/")
      }))
      expect(context.setPanelCloudflareTunnel).toHaveBeenCalledWith(runningTunnel)
      expect(setMessage).toHaveBeenLastCalledWith("Panel is shared at https://shared-panel.trycloudflare.com.")
    }))

  it("does not start a tunnel from an existing trycloudflare origin", () => {
    expectTryCloudflareOriginBlocked("https://already-shared.trycloudflare.com")
  })

  it("blocks generated trycloudflare origins before calling the API", () => {
    fc.assert(
      fc.property(tryCloudflareOriginArbitrary, (origin) => {
        expectTryCloudflareOriginBlocked(origin)
      }),
      { numRuns: 25 }
    )
  })

  it.effect("refreshes the panel tunnel", () =>
    Effect.gen(function*(_) {
      loadPanelCloudflareTunnelMock.mockImplementation(() => Effect.succeed(runningTunnel))
      const { context } = makeBrowserActionContext()

      refreshPanelCloudflareTunnel(context)
      yield* _(waitForAssertion(() => {
        expect(loadPanelCloudflareTunnelMock).toHaveBeenCalledTimes(1)
      }))
      expect(context.setPanelCloudflareTunnel).toHaveBeenLastCalledWith(runningTunnel)
    }))

  it.effect("copies the public tunnel URL after clipboard success", () =>
    expectCopyTunnelMessage(
      () => Effect.runPromise(Effect.void),
      "Tunnel URL copied."
    ))

  it.effect("reports clipboard copy failures", () =>
    expectCopyTunnelMessage(
      () => Effect.runPromise(Effect.fail(new Error("denied"))),
      "Failed to copy tunnel URL."
    ))

  it.effect("reports generated clipboard copy outcomes", () =>
    assertAsyncFastCheck(
      fc.asyncProperty(fc.boolean(), (succeeds) =>
        Effect.runPromise(
          expectCopyTunnelMessage(
            clipboardImplementation(succeeds),
            succeeds ? "Tunnel URL copied." : "Failed to copy tunnel URL."
          )
        )),
      { numRuns: 10 }
    ))

  it.effect("keeps generated stopped sessions in context", () =>
    assertAsyncFastCheck(
      fc.asyncProperty(stoppedAtArbitrary, (stoppedAt) =>
        Effect.runPromise(
          expectStoppedTunnelContext({
            ...runningTunnel,
            status: "stopped",
            stoppedAt
          })
        )),
      { numRuns: 15 }
    ))
})
