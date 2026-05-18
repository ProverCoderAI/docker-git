import { describe, expect, it } from "vitest"
import * as fc from "fast-check"

import {
  isLocalPanelHostname,
  isTryCloudflareHostname,
  parseTryCloudflareUrl,
  resolvePanelTunnelTargetUrl
} from "../src/services/panel-cloudflare-tunnel-core.js"

const localhostHost = "172.17.0.1"
const labelCharacters = "abcdefghijklmnopqrstuvwxyz0123456789"

const labelCharacter = (value: number): string =>
  labelCharacters[value] ?? "a"

const hostnameLabelArbitrary = fc.array(fc.integer({ min: 0, max: 35 }), {
  maxLength: 24,
  minLength: 1
}).map((values) => values.map((value) => labelCharacter(value)).join(""))

const urlSuffixArbitrary = fc.array(fc.integer({ min: 0, max: 35 }), {
  maxLength: 16,
  minLength: 0
}).map((values) => values.length === 0 ? "" : `/share/${values.map((value) => labelCharacter(value)).join("")}?tab=share#logs`)

const publicHostnameArbitrary = fc.oneof(
  fc.constantFrom("example.com", "public.example.net"),
  hostnameLabelArbitrary.map((label) => `${label}.example.com`)
)

const privateIpv4HostnameArbitrary = fc.constantFrom(
  "10.0.0.5",
  "100.64.0.1",
  "169.254.1.1",
  "172.16.0.1",
  "172.31.255.254",
  "192.168.1.2"
)

const loopbackHostnameArbitrary = fc.constantFrom("0.0.0.0", "127.0.0.1", "localhost")

const tryCloudflareHostnameArbitrary = hostnameLabelArbitrary.map((label) => `${label}.trycloudflare.com`)

const httpUrl = (
  protocol: "http" | "https",
  hostname: string,
  port: number,
  suffix: string
): string => `${protocol}://${hostname}:${port}${suffix}`

const originUrl = (value: string): string => {
  const url = new URL(value)
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  return url.toString()
}

const withoutTryCloudflareUrl = (value: string): boolean =>
  !value.toLowerCase().includes(".trycloudflare.com")

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

  it("normalizes generated private panel URLs to origins", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("http", "https"),
        privateIpv4HostnameArbitrary,
        fc.integer({ max: 65_535, min: 1 }),
        urlSuffixArbitrary,
        (protocol, hostname, port, suffix) => {
          const panelUrl = httpUrl(protocol, hostname, port, suffix)
          const expectedUrl = originUrl(panelUrl)

          expect(resolvePanelTunnelTargetUrl(panelUrl, localhostHost)).toEqual({
            ok: true,
            panelUrl: expectedUrl,
            targetUrl: expectedUrl
          })
        }
      )
    )
  })

  it("maps generated loopback panel URLs to the provided localhost host", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("http", "https"),
        loopbackHostnameArbitrary,
        fc.integer({ max: 65_535, min: 1 }),
        urlSuffixArbitrary,
        (protocol, hostname, port, suffix) => {
          const panelUrl = httpUrl(protocol, hostname, port, suffix)
          const expectedTarget = new URL(originUrl(panelUrl))
          expectedTarget.hostname = localhostHost

          expect(resolvePanelTunnelTargetUrl(panelUrl, localhostHost)).toEqual({
            ok: true,
            panelUrl: originUrl(panelUrl),
            targetUrl: expectedTarget.toString()
          })
        }
      )
    )
  })

  it("rejects generated public and trycloudflare hosts", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("http", "https"),
        publicHostnameArbitrary,
        fc.integer({ max: 65_535, min: 1 }),
        urlSuffixArbitrary,
        (protocol, hostname, port, suffix) => {
          expect(resolvePanelTunnelTargetUrl(httpUrl(protocol, hostname, port, suffix), localhostHost)).toEqual({
            ok: false,
            message: "panelUrl must point to localhost or a private LAN address."
          })
        }
      )
    )

    fc.assert(
      fc.property(
        tryCloudflareHostnameArbitrary,
        fc.integer({ max: 65_535, min: 1 }),
        urlSuffixArbitrary,
        (hostname, port, suffix) => {
          expect(isTryCloudflareHostname(hostname)).toBe(true)
          expect(resolvePanelTunnelTargetUrl(httpUrl("https", hostname, port, suffix), localhostHost)).toEqual({
            ok: false,
            message: "Open docker-git locally before starting a new Cloudflare tunnel."
          })
        }
      )
    )
  })

  it("extracts only generated quick tunnel URLs from noisy cloudflared output", () => {
    fc.assert(
      fc.property(
        fc.string().filter(withoutTryCloudflareUrl),
        tryCloudflareHostnameArbitrary,
        fc.string().filter(withoutTryCloudflareUrl),
        (prefix, hostname, suffix) => {
          expect(parseTryCloudflareUrl(`${prefix} https://${hostname} ${suffix}`)).toBe(`https://${hostname}`)
        }
      )
    )

    fc.assert(
      fc.property(fc.string().filter(withoutTryCloudflareUrl), (output) => {
        expect(parseTryCloudflareUrl(output)).toBeNull()
      })
    )
  })
})
