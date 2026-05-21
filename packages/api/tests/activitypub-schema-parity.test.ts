import { Follow, OrderedCollection, OrderedCollectionPage, Person } from "@fedify/vocab"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Either, Schema } from "effect"

import {
  activityStreamsJsonLdContext,
  actorJsonLdContext
} from "../src/api/contracts.js"
import { ForgeFedTicketSchema } from "../src/api/schema.js"
import {
  clearFederationState,
  createFollowSubscription,
  ingestFederationInbox,
  makeFederationContext
} from "../src/services/federation.js"
import {
  makeFedifyActorJsonLd,
  makeFedifyFollowersJsonLd,
  makeFedifyFollowersPageJsonLd,
  makeFedifyFollowingJsonLd,
  makeFedifyOutboxJsonLd
} from "../src/services/fedify-federation.js"

type JsonRecord = Record<string, unknown>

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const unsupportedMastodonTerms = [
  "https://purl.archive.org/socialweb/webfinger",
  "http://joinmastodon.org/ns#",
  "toot:",
  "featuredTags",
  "alsoKnownAs",
  "movedTo",
  "manuallyApprovesFollowers",
  "discoverable",
  "suspended",
  "memorial",
  "indexable",
  "interactionPolicy",
  "canQuote",
  "automaticApproval",
  "manualApproval",
  "showFeatured",
  "showMedia",
  "showRepliesInMedia"
] as const

const asRecord = (value: unknown): JsonRecord => {
  if (!isJsonRecord(value)) {
    throw new Error("Expected JSON object.")
  }
  return value
}

const readField = (record: JsonRecord, key: string): unknown =>
  Reflect.get(record, key)

const assertNoMastodonTerms = (value: unknown): void => {
  const serialized = JSON.stringify(value)
  for (const term of unsupportedMastodonTerms) {
    expect(serialized.includes(term)).toBe(false)
  }
}

const parsePerson = (payload: unknown) =>
  Effect.tryPromise({
    try: () => Person.fromJsonLd(payload),
    catch: (cause) => new Error(String(cause))
  })

const parseOrderedCollection = (payload: unknown) =>
  Effect.tryPromise({
    try: () => OrderedCollection.fromJsonLd(payload),
    catch: (cause) => new Error(String(cause))
  })

const parseOrderedCollectionPage = (payload: unknown) =>
  Effect.tryPromise({
    try: () => OrderedCollectionPage.fromJsonLd(payload),
    catch: (cause) => new Error(String(cause))
  })

const parseFollow = (payload: unknown) =>
  Effect.tryPromise({
    try: () => Follow.fromJsonLd(payload),
    catch: (cause) => new Error(String(cause))
  })

describe("ActivityPub and ForgeFed protocol parity", () => {
  it.effect("serializes the local actor through Fedify without Mastodon extension context", () =>
    Effect.gen(function*(_) {
      clearFederationState()
      const context = yield* _(
        makeFederationContext({
          publicOrigin: "https://social.provercoder.ai",
          actorUsername: "tasks"
        })
      )

      const payload = yield* _(makeFedifyActorJsonLd(context))
      const actor = asRecord(payload)
      const publicKey = asRecord(readField(actor, "publicKey"))

      expect(readField(actor, "@context")).toEqual(actorJsonLdContext)
      expect(readField(actor, "type")).toBe("Person")
      expect(readField(actor, "id")).toBe("https://social.provercoder.ai/federation/actor")
      expect(readField(actor, "preferredUsername")).toBe("tasks")
      expect(readField(actor, "followers")).toBe("https://social.provercoder.ai/federation/followers")
      expect(readField(publicKey, "owner")).toBe("https://social.provercoder.ai/federation/actor")
      expect(typeof readField(publicKey, "publicKeyPem")).toBe("string")
      assertNoMastodonTerms(payload)

      const parsed = yield* _(parsePerson(payload))
      expect(parsed.id?.href).toBe("https://social.provercoder.ai/federation/actor")
      expect(parsed.preferredUsername).toBe("tasks")
    }))

  it.effect("serializes followers collection and page through Fedify ActivityStreams objects", () =>
    Effect.gen(function*(_) {
      clearFederationState()
      const context = yield* _(
        makeFederationContext({
          publicOrigin: "https://social.provercoder.ai",
          actorUsername: "tasks"
        })
      )

      const collectionPayload = yield* _(makeFedifyFollowersJsonLd(context))
      const collection = asRecord(collectionPayload)
      expect(readField(collection, "@context")).toBe(activityStreamsJsonLdContext)
      expect(readField(collection, "type")).toBe("OrderedCollection")
      expect(readField(collection, "id")).toBe("https://social.provercoder.ai/federation/followers")
      expect(readField(collection, "first")).toBe("https://social.provercoder.ai/federation/followers?page=1")
      assertNoMastodonTerms(collectionPayload)
      yield* _(parseOrderedCollection(collectionPayload))

      const pagePayload = yield* _(makeFedifyFollowersPageJsonLd(context))
      const page = asRecord(pagePayload)
      expect(readField(page, "@context")).toBe(activityStreamsJsonLdContext)
      expect(readField(page, "type")).toBe("OrderedCollectionPage")
      expect(readField(page, "id")).toBe("https://social.provercoder.ai/federation/followers?page=1")
      expect(readField(page, "partOf")).toBe("https://social.provercoder.ai/federation/followers")
      assertNoMastodonTerms(pagePayload)
      yield* _(parseOrderedCollectionPage(pagePayload))
    }))

  it.effect("serializes follow activities and accepted following state through Fedify", () =>
    Effect.gen(function*(_) {
      clearFederationState()
      const context = yield* _(
        makeFederationContext({
          publicOrigin: "https://social.provercoder.ai",
          actorUsername: "tasks"
        })
      )

      const created = yield* _(
        createFollowSubscription(
          {
            object: "https://tracker.provercoder.ai/issues/followers"
          },
          context
        )
      )

      const outboxPayload = yield* _(makeFedifyOutboxJsonLd(context))
      const outbox = asRecord(outboxPayload)
      const orderedItems = readField(outbox, "orderedItems")
      expect(readField(outbox, "@context")).toBe(activityStreamsJsonLdContext)
      expect(readField(outbox, "type")).toBe("OrderedCollection")
      expect(Array.isArray(orderedItems)).toBe(true)
      if (!Array.isArray(orderedItems)) {
        throw new Error("Expected outbox orderedItems.")
      }
      const follow = asRecord(orderedItems[0])
      expect(readField(follow, "type")).toBe("Follow")
      expect(readField(follow, "id")).toBe(created.activity.id)
      expect(readField(follow, "actor")).toBe("https://social.provercoder.ai/federation/actor")
      expect(readField(follow, "object")).toBe("https://tracker.provercoder.ai/issues/followers")
      assertNoMastodonTerms(outboxPayload)
      yield* _(parseFollow(follow))

      yield* _(
        ingestFederationInbox({
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://forgefed.org/ns"
          ],
          type: "Accept",
          object: created.activity.id
        })
      )

      const followingPayload = yield* _(makeFedifyFollowingJsonLd(context))
      const following = asRecord(followingPayload)
      expect(readField(following, "type")).toBe("OrderedCollection")
      expect(readField(following, "totalItems")).toBe(1)
      expect(readField(following, "orderedItems")).toEqual([
        "https://tracker.provercoder.ai/issues/followers"
      ])
      assertNoMastodonTerms(followingPayload)
      yield* _(parseOrderedCollection(followingPayload))
    }))

  it.effect("keeps ForgeFed Ticket validation at the JSON boundary", () =>
    Effect.sync(() => {
      const decoded = Schema.decodeUnknownEither(ForgeFedTicketSchema)({
        id: "https://tracker.example/issues/42",
        attributedTo: "https://tracker.example/users/alice",
        summary: "Implement protocol proof",
        content: "Use ActivityPub and ForgeFed boundary validation.",
        attachment: [
          {
            type: "Document",
            url: "https://tracker.example/issues/42/log"
          }
        ],
        raw: {
          type: "Ticket"
        }
      })

      expect(Either.isRight(decoded)).toBe(true)
    }))
})
