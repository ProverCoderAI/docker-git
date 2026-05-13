import * as HttpApp from "@effect/platform/HttpApp"
import * as HttpRouter from "@effect/platform/HttpRouter"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import fc from "fast-check"

import {
  activityForgeFedJsonLdContext,
  actorJsonLdContext,
  federationJsonLdResponseContentType
} from "../src/api/contracts.js"
import {
  federationActorDocumentResponse,
  federationExchangeStatusResponse,
  federationFollowersDocumentResponse,
  federationFollowingDocumentResponse,
  federationLikedDocumentResponse,
  federationOutboxDocumentResponse,
  resolveConfiguredFederationPublicOrigin
} from "../src/http.js"
import { clearFederationState } from "../src/services/federation.js"

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

const federationStatusHandler = HttpApp.toWebHandler(
  Effect.flatten(
    HttpRouter.toHttpApp(
      HttpRouter.empty.pipe(
        HttpRouter.get("/federation/status", federationExchangeStatusResponse()),
        HttpRouter.get("/federation/exchange/status", federationExchangeStatusResponse())
      )
    )
  )
)

const federationDocumentHandler = HttpApp.toWebHandler(
  Effect.flatten(
    HttpRouter.toHttpApp(
      HttpRouter.empty.pipe(
        HttpRouter.get("/federation/actor", federationActorDocumentResponse()),
        HttpRouter.get("/federation/outbox", federationOutboxDocumentResponse()),
        HttpRouter.get("/federation/followers", federationFollowersDocumentResponse()),
        HttpRouter.get("/federation/following", federationFollowingDocumentResponse()),
        HttpRouter.get("/federation/liked", federationLikedDocumentResponse())
      )
    )
  )
)

const readFederationStatusRoute = (path: string) =>
  Effect.gen(function*(_) {
    const response = yield* _(
      Effect.tryPromise({
        try: () =>
          federationStatusHandler(
            new Request(`http://127.0.0.1${path}`, {
              headers: {
                "x-forwarded-host": "public.example.test",
                "x-forwarded-proto": "https"
              }
            })
          ),
        catch: (cause) => new Error(String(cause))
      })
    )
    const body = yield* _(
      Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new Error(String(cause))
      })
    )
    return { body, status: response.status }
  })

const readFederationDocumentRoute = (path: string) =>
  Effect.gen(function*(_) {
    const response = yield* _(
      Effect.tryPromise({
        try: () =>
          federationDocumentHandler(
            new Request(`http://127.0.0.1${path}`, {
              headers: {
                "x-forwarded-host": "public.example.test",
                "x-forwarded-proto": "https"
              }
            })
          ),
        catch: (cause) => new Error(String(cause))
      })
    )
    const body = yield* _(
      Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new Error(String(cause))
      })
    )
    return { body, contentType: response.headers.get("content-type"), status: response.status }
  })

const parseJsonObject = (raw: string): object | null => {
  const parsed: unknown = JSON.parse(raw)
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed
    : null
}

const readField = (value: object | null, key: string): unknown =>
  value === null ? undefined : Reflect.get(value, key)

const federationDocumentCases: ReadonlyArray<{
  readonly path: string
  readonly expectedContext: unknown
  readonly expectedId: string
  readonly expectedType: string
}> = [
  {
    path: "/federation/actor",
    expectedContext: actorJsonLdContext,
    expectedId: "https://public.example.test/federation/actor",
    expectedType: "Person"
  },
  {
    path: "/federation/outbox",
    expectedContext: activityForgeFedJsonLdContext,
    expectedId: "https://public.example.test/federation/outbox",
    expectedType: "OrderedCollection"
  },
  {
    path: "/federation/followers",
    expectedContext: activityForgeFedJsonLdContext,
    expectedId: "https://public.example.test/federation/followers",
    expectedType: "OrderedCollection"
  },
  {
    path: "/federation/following",
    expectedContext: activityForgeFedJsonLdContext,
    expectedId: "https://public.example.test/federation/following",
    expectedType: "OrderedCollection"
  },
  {
    path: "/federation/liked",
    expectedContext: activityForgeFedJsonLdContext,
    expectedId: "https://public.example.test/federation/liked",
    expectedType: "OrderedCollection"
  }
]

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

  it.effect("serves equivalent federation status aliases at the HTTP layer", () =>
    Effect.gen(function*(_) {
      yield* _(Effect.sync(() => clearFederationState()))

      const publicStatus = yield* _(readFederationStatusRoute("/federation/status"))
      const compatibilityStatus = yield* _(readFederationStatusRoute("/federation/exchange/status"))
      const payload = parseJsonObject(publicStatus.body)

      expect(publicStatus.status).toBe(200)
      expect(compatibilityStatus.status).toBe(200)
      expect(compatibilityStatus.body).toBe(publicStatus.body)
      expect(payload).not.toBeNull()
      expect(readField(payload, "publicActor")).toBe("https://public.example.test/federation/actor")
      expect(typeof readField(payload, "summary")).toBe("object")
      expect(Array.isArray(readField(payload, "subscriptions"))).toBe(true)
      expect(Array.isArray(readField(payload, "recentEvents"))).toBe(true)
    }))

  for (const documentCase of federationDocumentCases) {
    it.effect(`serves ${documentCase.path} as JSON-LD`, () =>
      Effect.gen(function*(_) {
        yield* _(Effect.sync(() => clearFederationState()))

        const document = yield* _(readFederationDocumentRoute(documentCase.path))
        const payload = parseJsonObject(document.body)

        expect(document.status).toBe(200)
        expect(document.contentType).toBe(federationJsonLdResponseContentType)
        expect(readField(payload, "@context")).toEqual(documentCase.expectedContext)
        expect(readField(payload, "type")).toBe(documentCase.expectedType)
        expect(readField(payload, "id")).toBe(documentCase.expectedId)
      }))
  }
})
