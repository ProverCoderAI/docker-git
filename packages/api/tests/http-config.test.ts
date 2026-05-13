import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { resolveConfiguredFederationPublicOrigin } from "../src/http.js"

describe("api http config", () => {
  it.effect("ignores empty federation public origin values", () =>
    Effect.sync(() => {
      expect(
        resolveConfiguredFederationPublicOrigin({
          DOCKER_GIT_API_PUBLIC_URL: " https://api.example.test ",
          DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN: " "
        })
      ).toBe("https://api.example.test")
    }))

  it.effect("prefers explicit federation public origin over api public url", () =>
    Effect.sync(() => {
      expect(
        resolveConfiguredFederationPublicOrigin({
          DOCKER_GIT_API_PUBLIC_URL: "https://api.example.test",
          DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN: "https://federation.example.test"
        })
      ).toBe("https://federation.example.test")
    }))
})
