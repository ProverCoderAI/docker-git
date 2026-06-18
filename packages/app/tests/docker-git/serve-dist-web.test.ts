import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { resolveForwardedHost, resolveForwardedProto } from "../../scripts/serve-dist-web-forwarding.mjs"
import { shouldProxyHttpPath } from "../../scripts/serve-dist-web-routing.mjs"

describe("serve-dist-web routing", () => {
  it.effect("proxies root WebFinger to API", () =>
    Effect.sync(() => {
      expect(shouldProxyHttpPath("/.well-known/webfinger")).toBe(true)
      expect(shouldProxyHttpPath("/.well-known/webfinger/extra")).toBe(false)
      expect(shouldProxyHttpPath("/api/.well-known/webfinger")).toBe(true)
      expect(shouldProxyHttpPath("/federation/actor")).toBe(true)
      expect(shouldProxyHttpPath("/unknown-route")).toBe(false)
    }))

  it.effect("preserves HTTPS forwarding semantics for Cloudflare tunnel requests", () =>
    Effect.sync(() => {
      expect(resolveForwardedHost({
        host: "orange-field.trycloudflare.com"
      })).toBe("orange-field.trycloudflare.com")
      expect(resolveForwardedProto({
        host: "orange-field.trycloudflare.com"
      })).toBe("https")
      expect(resolveForwardedProto({
        "cf-visitor": "{\"scheme\":\"https\"}",
        host: "127.0.0.1:4174"
      })).toBe("https")
      expect(resolveForwardedProto({
        "x-forwarded-proto": "http",
        host: "orange-field.trycloudflare.com"
      })).toBe("http")
    }))
})
