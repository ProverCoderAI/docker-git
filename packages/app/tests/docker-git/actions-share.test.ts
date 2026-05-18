import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import {
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
    vi.stubGlobal("location", {
      origin: "https://already-shared.trycloudflare.com"
    })
    const { context, setMessage } = makeBrowserActionContext()

    startPanelShareTunnel(context)

    expect(startPanelCloudflareTunnelMock).not.toHaveBeenCalled()
    expect(setMessage).toHaveBeenLastCalledWith("Open docker-git locally before starting a new Cloudflare tunnel.")
  })

  it.effect("refreshes and stops the panel tunnel", () =>
    Effect.gen(function*(_) {
      loadPanelCloudflareTunnelMock.mockImplementation(() => Effect.succeed(runningTunnel))
      stopPanelCloudflareTunnelMock.mockImplementation(() =>
        Effect.succeed({ ...runningTunnel, status: "stopped", stoppedAt: "2026-05-18T00:01:00.000Z" })
      )
      const { context } = makeBrowserActionContext()

      refreshPanelCloudflareTunnel(context)
      yield* _(waitForAssertion(() => {
        expect(loadPanelCloudflareTunnelMock).toHaveBeenCalledTimes(1)
      }))
      expect(context.setPanelCloudflareTunnel).toHaveBeenLastCalledWith(runningTunnel)

      stopPanelShareTunnel(context)
      yield* _(waitForAssertion(() => {
        expect(stopPanelCloudflareTunnelMock).toHaveBeenCalledTimes(1)
      }))
      expect(context.setPanelCloudflareTunnel).toHaveBeenLastCalledWith({
        ...runningTunnel,
        status: "stopped",
        stoppedAt: "2026-05-18T00:01:00.000Z"
      })
    }))
})
