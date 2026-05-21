import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

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
})
