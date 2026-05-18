import { describe, expect, it } from "vitest"

import {
  isLocalPanelHostname,
  isTryCloudflareHostname,
  parseTryCloudflareUrl,
  resolvePanelTunnelTargetUrl
} from "../src/services/panel-cloudflare-tunnel-core.js"

describe("panel Cloudflare tunnel core", () => {
  it("normalizes panel URLs to their origin", () => {
    expect(resolvePanelTunnelTargetUrl("http://192.168.0.206:4174/ports/project", "172.17.0.1")).toEqual({
      ok: true,
      panelUrl: "http://192.168.0.206:4174/",
      targetUrl: "http://192.168.0.206:4174/"
    })
  })

  it("maps localhost panel URLs to the controller-visible host", () => {
    expect(resolvePanelTunnelTargetUrl("http://localhost:4174/", "172.17.0.1")).toEqual({
      ok: true,
      panelUrl: "http://localhost:4174/",
      targetUrl: "http://172.17.0.1:4174/"
    })
    expect(isLocalPanelHostname("127.0.0.1")).toBe(true)
    expect(isLocalPanelHostname("::1")).toBe(true)
  })

  it("allows private LAN panel URLs without remapping them", () => {
    expect(resolvePanelTunnelTargetUrl("http://192.168.0.206:4174/share", "172.17.0.1")).toEqual({
      ok: true,
      panelUrl: "http://192.168.0.206:4174/",
      targetUrl: "http://192.168.0.206:4174/"
    })
    expect(isLocalPanelHostname("172.19.0.59")).toBe(true)
  })

  it("rejects non-panel public hosts", () => {
    expect(isTryCloudflareHostname("example.com")).toBe(false)
    expect(resolvePanelTunnelTargetUrl("https://example.com/", "172.17.0.1")).toEqual({
      ok: false,
      message: "panelUrl must point to localhost or a private LAN address."
    })
  })

  it("rejects trycloudflare targets to avoid tunnel loops", () => {
    expect(isTryCloudflareHostname("abc.trycloudflare.com")).toBe(true)
    expect(resolvePanelTunnelTargetUrl("https://abc.trycloudflare.com/", "172.17.0.1")).toEqual({
      ok: false,
      message: "Open docker-git locally before starting a new Cloudflare tunnel."
    })
  })

  it("parses generated quick tunnel URLs from cloudflared output", () => {
    expect(
      parseTryCloudflareUrl("INF +--------------------------------------------------------------------------------------------+")
    ).toBeNull()
    expect(
      parseTryCloudflareUrl("INF |  https://yellow-field-123.trycloudflare.com                                      |")
    ).toBe("https://yellow-field-123.trycloudflare.com")
  })
})
