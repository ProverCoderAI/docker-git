import * as HttpApp from "@effect/platform/HttpApp"
import * as HttpRouter from "@effect/platform/HttpRouter"
import { OrderedCollectionPage } from "@fedify/vocab"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import fc from "fast-check"

import {
  activityStreamsJsonLdContext,
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
  federationWebFingerResponse,
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
        HttpRouter.get("/.well-known/webfinger", federationWebFingerResponse()),
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

const readNestedField = (value: object | null, parent: string, key: string): unknown => {
  const nested = readField(value, parent)
  return typeof nested === "object" && nested !== null ? Reflect.get(nested, key) : undefined
}

type JsonRecord = Record<string, unknown>

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const unsupportedMastodonContextTerms = [
  "https://purl.archive.org/socialweb/webfinger",
  "http://joinmastodon.org/ns#",
  "toot:"
] as const

const unsupportedMastodonKeys = [
  "toot",
  "featured",
  "featuredTags",
  "alsoKnownAs",
  "movedTo",
  "manuallyApprovesFollowers",
  "discoverable",
  "suspended",
  "interactionPolicy",
  "canQuote",
  "automaticApproval",
  "manualApproval"
] as const

const assertNoMastodonContextTerms = (value: unknown): void => {
  if (typeof value === "string") {
    for (const term of unsupportedMastodonContextTerms) {
      expect(value.includes(term)).toBe(false)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoMastodonContextTerms(item)
    }
    return
  }
  if (isJsonRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      expect(unsupportedMastodonKeys.some((unsupportedKey) => unsupportedKey === key)).toBe(false)
      assertNoMastodonContextTerms(item)
    }
  }
}

const assertNoMastodonKeys = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoMastodonKeys(item)
    }
    return
  }
  if (isJsonRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      expect(unsupportedMastodonKeys.some((unsupportedKey) => unsupportedKey === key)).toBe(false)
      assertNoMastodonKeys(item)
    }
  }
}

const assertNoMastodonTerms = (payload: object | null): void => {
  if (payload === null) {
    return
  }
  assertNoMastodonContextTerms(Reflect.get(payload, "@context"))
  assertNoMastodonKeys(payload)
}

const parseOrderedCollectionPage = (payload: unknown) =>
  Effect.tryPromise({
    try: () => OrderedCollectionPage.fromJsonLd(payload),
    catch: (cause) => new Error(String(cause))
  })

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
    expectedContext: activityStreamsJsonLdContext,
    expectedId: "https://public.example.test/federation/outbox",
    expectedType: "OrderedCollection"
  },
  {
    path: "/federation/followers",
    expectedContext: activityStreamsJsonLdContext,
    expectedId: "https://public.example.test/federation/followers",
    expectedType: "OrderedCollection"
  },
  {
    path: "/federation/following",
    expectedContext: activityStreamsJsonLdContext,
    expectedId: "https://public.example.test/federation/following",
    expectedType: "OrderedCollection"
  },
  {
    path: "/federation/liked",
    expectedContext: activityStreamsJsonLdContext,
    expectedId: "https://public.example.test/federation/liked",
    expectedType: "OrderedCollection"
  }
]

const webFingerResourceArbitrary = fc.constantFrom(
  "acct:docker-git@public.example.test",
  "https://public.example.test/federation/actor"
)

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
        assertNoMastodonTerms(payload)
      }))
  }

  it.effect("serves followers page as Fedify ActivityPub JSON-LD", () =>
    Effect.gen(function*(_) {
      yield* _(Effect.sync(() => clearFederationState()))

      const document = yield* _(readFederationDocumentRoute("/federation/followers?page=1"))
      const payload = parseJsonObject(document.body)

      expect(document.status).toBe(200)
      expect(document.contentType).toBe(federationJsonLdResponseContentType)
      const page = yield* _(parseOrderedCollectionPage(payload))
      expect(page.id?.href).toBe("https://public.example.test/federation/followers?page=1")
      expect(page.partOfId?.href).toBe("https://public.example.test/federation/followers")
      expect(page.totalItems).toBe(0)
      assertNoMastodonTerms(payload)
    }))

  it.effect("serves WebFinger through Fedify", () =>
    Effect.gen(function*(_) {
      yield* _(Effect.sync(() => clearFederationState()))

      const document = yield* _(
        readFederationDocumentRoute(
          "/.well-known/webfinger?resource=acct:docker-git@public.example.test"
        )
      )
      const payload = parseJsonObject(document.body)
      const links = readField(payload, "links")

      expect(document.status).toBe(200)
      expect(document.contentType).toBe("application/jrd+json")
      expect(readField(payload, "subject")).toBe("acct:docker-git@public.example.test")
      expect(readField(payload, "aliases")).toEqual([
        "https://public.example.test/federation/actor"
      ])
      expect(Array.isArray(links)).toBe(true)
      if (!Array.isArray(links)) {
        throw new Error("Expected WebFinger links.")
      }
      expect(links[0]).toEqual({
        rel: "self",
        href: "https://public.example.test/federation/actor",
        type: "application/activity+json"
      })
    }))

  it.effect("satisfies WebFinger invariants for supported actor resources", () =>
    Effect.tryPromise({
      try: () =>
        fc.assert(
          fc.asyncProperty(webFingerResourceArbitrary, (resource) =>
            Effect.runPromise(
              Effect.gen(function*(_) {
                yield* _(Effect.sync(() => clearFederationState()))
                const document = yield* _(
                  readFederationDocumentRoute(
                    `/.well-known/webfinger?resource=${encodeURIComponent(resource)}`
                  )
                )
                const payload = parseJsonObject(document.body)
                if (payload === null) {
                  throw new Error("Expected WebFinger JSON object.")
                }
                const aliases = readField(payload, "aliases")
                const links = readField(payload, "links")

                expect(document.status).toBe(200)
                expect(readField(payload, "subject")).toBe(resource)
                expect(Array.isArray(aliases)).toBe(true)
                if (!Array.isArray(aliases)) {
                  throw new Error("Expected WebFinger aliases.")
                }
                yield* _(
                  Effect.forEach(
                    aliases,
                    (alias) =>
                      Effect.sync(() => {
                        expect(new URL(String(alias)).href).toBe(String(alias))
                      }),
                    { discard: true }
                  )
                )

                expect(Array.isArray(links)).toBe(true)
                if (!Array.isArray(links)) {
                  throw new Error("Expected WebFinger links.")
                }
                const selfLink = links
                  .filter(isJsonRecord)
                  .find((link) =>
                    readField(link, "rel") === "self" &&
                    readField(link, "type") === "application/activity+json")
                if (selfLink === undefined) {
                  throw new Error("Expected WebFinger self link.")
                }
                const actorHref = readField(selfLink, "href")
                expect(actorHref).toBe("https://public.example.test/federation/actor")

                const actor = yield* _(readFederationDocumentRoute("/federation/actor"))
                const actorPayload = parseJsonObject(actor.body)
                expect(actor.status).toBe(200)
                expect(readField(actorPayload, "id")).toBe(actorHref)
                expect(readField(actorPayload, "type")).toBe("Person")
              })
            )
          ),
          { numRuns: 4 }
        ),
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
    }))

  it.effect("rejects unsupported followers pages", () =>
    Effect.gen(function*(_) {
      yield* _(Effect.sync(() => clearFederationState()))

      const document = yield* _(readFederationDocumentRoute("/federation/followers?page=2"))
      const payload = parseJsonObject(document.body)

      expect(document.status).toBe(400)
      expect(readNestedField(payload, "error", "type")).toBe("ApiBadRequestError")
      expect(readNestedField(payload, "error", "message")).toBe("Unsupported followers page: 2")
    }))
})
