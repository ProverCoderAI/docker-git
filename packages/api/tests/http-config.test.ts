import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import fc from "fast-check"

import { resolveConfiguredFederationPublicOrigin } from "../src/http.js"

const envValueArbitrary = fc.option(
  fc.oneof(
    fc.string(),
    fc.constant(" "),
    fc.constant("\t\n")
  ),
  { nil: undefined }
)

const expectedConfiguredFederationPublicOrigin = (
  federationPublicOrigin: string | undefined,
  apiPublicUrl: string | undefined
): string | undefined => {
  const federation = federationPublicOrigin?.trim()
  if (federation !== undefined && federation.length > 0) {
    return federation
  }

  const api = apiPublicUrl?.trim()
  return api !== undefined && api.length > 0 ? api : undefined
}

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

  it.effect("satisfies federation origin trim and priority invariant", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          envValueArbitrary,
          envValueArbitrary,
          (federationPublicOrigin, apiPublicUrl) => {
            const result = resolveConfiguredFederationPublicOrigin({
              DOCKER_GIT_API_PUBLIC_URL: apiPublicUrl,
              DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN: federationPublicOrigin
            })
            const expected = expectedConfiguredFederationPublicOrigin(
              federationPublicOrigin,
              apiPublicUrl
            )

            expect(result).toBe(expected)
            expect(result).toBe(result?.trim())
          }
        )
      )
    }))
})
