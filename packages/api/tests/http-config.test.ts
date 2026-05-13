import { describe, expect, it } from "vitest"

import { resolveConfiguredFederationPublicOrigin } from "../src/http.js"

describe("api http config", () => {
  it("ignores empty federation public origin values", () => {
    expect(
      resolveConfiguredFederationPublicOrigin({
        DOCKER_GIT_API_PUBLIC_URL: " https://api.example.test ",
        DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN: " "
      })
    ).toBe("https://api.example.test")
  })

  it("prefers explicit federation public origin over api public url", () => {
    expect(
      resolveConfiguredFederationPublicOrigin({
        DOCKER_GIT_API_PUBLIC_URL: "https://api.example.test",
        DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN: "https://federation.example.test"
      })
    ).toBe("https://federation.example.test")
  })
})
