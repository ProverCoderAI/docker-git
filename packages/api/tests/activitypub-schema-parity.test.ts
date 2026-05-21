import { describe, expect, it } from "@effect/vitest"
import { Effect, Either, ParseResult, Schema } from "effect"
import fc from "fast-check"

import {
  ActivityPubOrderedCollectionPageSchema,
  ActivityPubOrderedCollectionSchema,
  ActivityPubPersonSchema
} from "../src/api/schema.js"

const expectDecodedCoversFixtureKeys = (decoded: object, fixture: object): void => {
  expect(Object.keys(decoded)).toEqual(expect.arrayContaining(Object.keys(fixture)))
}

const activityPubContextArbitrary = fc.constant("https://www.w3.org/ns/activitystreams")

const activityPubActorContextArbitrary = fc.constant([
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  "https://forgefed.org/ns"
] as const)

const schemaStringArbitrary = fc.string()

const nonPersonTypeArbitrary = fc.string().filter((value) => value !== "Person")

const nonOrderedCollectionTypeArbitrary = fc
  .string()
  .filter((value) => value !== "OrderedCollection")

const nonOrderedCollectionPageTypeArbitrary = fc
  .string()
  .filter((value) => value !== "OrderedCollectionPage")

const activityPubPersonRequiredFieldsArbitrary = fc.record({
  "@context": activityPubActorContextArbitrary,
  type: fc.constant("Person"),
  id: schemaStringArbitrary,
  name: schemaStringArbitrary,
  preferredUsername: schemaStringArbitrary,
  summary: schemaStringArbitrary,
  inbox: schemaStringArbitrary,
  outbox: schemaStringArbitrary,
  followers: schemaStringArbitrary,
  following: schemaStringArbitrary
})

const activityPubPersonMissingRequiredFieldsArbitrary = fc.record({
  "@context": activityPubActorContextArbitrary,
  type: fc.constant("Person"),
  id: schemaStringArbitrary
})

const activityPubOrderedCollectionRequiredFieldsArbitrary = fc.record({
  "@context": activityPubContextArbitrary,
  type: fc.constant("OrderedCollection"),
  id: schemaStringArbitrary,
  totalItems: fc.integer({ min: 0 })
})

const activityPubOrderedCollectionMissingRequiredFieldsArbitrary = fc.record({
  "@context": activityPubContextArbitrary,
  type: fc.constant("OrderedCollection"),
  id: schemaStringArbitrary
})

const activityPubOrderedCollectionPageRequiredFieldsArbitrary = fc.record({
  "@context": activityPubContextArbitrary,
  type: fc.constant("OrderedCollectionPage"),
  id: schemaStringArbitrary,
  totalItems: fc.integer({ min: 0 }),
  partOf: schemaStringArbitrary,
  orderedItems: fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)))
})

const activityPubOrderedCollectionPageMissingRequiredFieldsArbitrary = fc.record({
  "@context": activityPubContextArbitrary,
  type: fc.constant("OrderedCollectionPage"),
  id: schemaStringArbitrary,
  totalItems: fc.integer({ min: 0 }),
  orderedItems: fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)))
})

const mastodonActorFixture = {
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    "https://purl.archive.org/socialweb/webfinger",
    {
      manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
      toot: "http://joinmastodon.org/ns#",
      featured: {
        "@id": "toot:featured",
        "@type": "@id"
      },
      featuredTags: {
        "@id": "toot:featuredTags",
        "@type": "@id"
      },
      alsoKnownAs: {
        "@id": "as:alsoKnownAs",
        "@type": "@id"
      },
      movedTo: {
        "@id": "as:movedTo",
        "@type": "@id"
      },
      schema: "http://schema.org/#",
      PropertyValue: "schema:PropertyValue",
      value: "schema:value",
      discoverable: "toot:discoverable",
      suspended: "toot:suspended",
      memorial: "toot:memorial",
      indexable: "toot:indexable",
      attributionDomains: {
        "@id": "toot:attributionDomains",
        "@type": "@id"
      },
      showFeatured: "toot:showFeatured",
      showMedia: "toot:showMedia",
      showRepliesInMedia: "toot:showRepliesInMedia",
      gts: "https://gotosocial.org/ns#",
      interactionPolicy: {
        "@id": "gts:interactionPolicy",
        "@type": "@id"
      },
      canQuote: {
        "@id": "gts:canQuote",
        "@type": "@id"
      },
      automaticApproval: {
        "@id": "gts:automaticApproval",
        "@type": "@id"
      },
      manualApproval: {
        "@id": "gts:manualApproval",
        "@type": "@id"
      }
    }
  ],
  id: "https://mastodon.social/users/GordonFreeman",
  webfinger: "GordonFreeman@mastodon.social",
  type: "Person",
  following: "https://mastodon.social/users/GordonFreeman/following",
  followers: "https://mastodon.social/users/GordonFreeman/followers",
  inbox: "https://mastodon.social/users/GordonFreeman/inbox",
  outbox: "https://mastodon.social/users/GordonFreeman/outbox",
  featured: "https://mastodon.social/users/GordonFreeman/collections/featured",
  featuredTags: "https://mastodon.social/users/GordonFreeman/collections/tags",
  preferredUsername: "GordonFreeman",
  name: "GordonFreeman",
  summary: "",
  url: "https://mastodon.social/@GordonFreeman",
  manuallyApprovesFollowers: false,
  discoverable: false,
  indexable: false,
  published: "2022-05-11T00:00:00Z",
  memorial: false,
  showFeatured: true,
  showMedia: true,
  showRepliesInMedia: true,
  interactionPolicy: {
    canFeature: {
      automaticApproval: ["https://mastodon.social/users/GordonFreeman"]
    }
  },
  featuredCollections: "https://mastodon.social/ap/users/108283196203417442/featured_collections",
  publicKey: {
    id: "https://mastodon.social/users/GordonFreeman#main-key",
    owner: "https://mastodon.social/users/GordonFreeman",
    publicKeyPem:
      "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest\n-----END PUBLIC KEY-----\n"
  },
  tag: [],
  attachment: [],
  endpoints: {
    sharedInbox: "https://mastodon.social/inbox"
  }
}

const mastodonFollowersCollectionFixture = {
  "@context": "https://www.w3.org/ns/activitystreams",
  id: "https://mastodon.social/users/nixCraft/followers",
  type: "OrderedCollection",
  totalItems: 114133,
  first: "https://mastodon.social/users/nixCraft/followers?page=1"
}

const mastodonFollowersPageFixture = {
  "@context": "https://www.w3.org/ns/activitystreams",
  id: "https://mastodon.social/users/nixCraft/followers?page=1",
  type: "OrderedCollectionPage",
  totalItems: 114133,
  partOf: "https://mastodon.social/users/nixCraft/followers",
  next: "https://mastodon.social/users/nixCraft/followers?max_id=123&page=1",
  orderedItems: [
    "https://mastodon.social/users/GordonFreeman",
    {
      id: "https://mastodon.social/users/example",
      type: "Person",
      following: "https://mastodon.social/users/example/following",
      followers: "https://mastodon.social/users/example/followers",
      inbox: "https://mastodon.social/users/example/inbox",
      outbox: "https://mastodon.social/users/example/outbox",
      preferredUsername: "example",
      publicKey: {
        id: "https://mastodon.social/users/example#main-key",
        owner: "https://mastodon.social/users/example",
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest\n-----END PUBLIC KEY-----\n"
      }
    }
  ]
}

describe("ActivityPub and ForgeFed schema parity", () => {
  it.effect("decodes a Mastodon actor Person fixture", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(ActivityPubPersonSchema)(mastodonActorFixture)

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (decoded) => {
          expectDecodedCoversFixtureKeys(decoded, mastodonActorFixture)
        }
      })
    }))

  it.effect("decodes a Mastodon followers OrderedCollection fixture", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(ActivityPubOrderedCollectionSchema)(
        mastodonFollowersCollectionFixture
      )

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (decoded) => {
          expectDecodedCoversFixtureKeys(decoded, mastodonFollowersCollectionFixture)
        }
      })
    }))

  it.effect("decodes a Mastodon followers OrderedCollectionPage fixture", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(ActivityPubOrderedCollectionPageSchema)(
        mastodonFollowersPageFixture
      )

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (decoded) => {
          expectDecodedCoversFixtureKeys(decoded, mastodonFollowersPageFixture)
        }
      })
    }))

  it.effect("rejects ActivityPub objects with wrong literal types", () =>
    Effect.sync(() => {
      const personResult = Schema.decodeUnknownEither(ActivityPubPersonSchema)({
        ...mastodonActorFixture,
        type: "Service"
      })
      const collectionResult = Schema.decodeUnknownEither(ActivityPubOrderedCollectionSchema)({
        ...mastodonFollowersCollectionFixture,
        type: "Collection"
      })
      const pageResult = Schema.decodeUnknownEither(ActivityPubOrderedCollectionPageSchema)({
        ...mastodonFollowersPageFixture,
        type: "OrderedCollection"
      })

      expect(Either.isLeft(personResult)).toBe(true)
      expect(Either.isLeft(collectionResult)).toBe(true)
      expect(Either.isLeft(pageResult)).toBe(true)
    }))

  it.effect("rejects ActivityPub objects missing required fields", () =>
    Effect.sync(() => {
      const personResult = Schema.decodeUnknownEither(ActivityPubPersonSchema)({
        type: "Person",
        id: "https://mastodon.social/users/missing"
      })
      const collectionResult = Schema.decodeUnknownEither(ActivityPubOrderedCollectionSchema)({
        type: "OrderedCollection",
        id: "https://mastodon.social/users/nixCraft/followers"
      })
      const pageResult = Schema.decodeUnknownEither(ActivityPubOrderedCollectionPageSchema)({
        type: "OrderedCollectionPage",
        id: "https://mastodon.social/users/nixCraft/followers?page=1",
        orderedItems: []
      })

      expect(Either.isLeft(personResult)).toBe(true)
      expect(Either.isLeft(collectionResult)).toBe(true)
      expect(Either.isLeft(pageResult)).toBe(true)
    }))

  it.effect("accepts ActivityPub Person objects with required fields and correct type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubPersonRequiredFieldsArbitrary, (person) => {
          expect(Either.isRight(Schema.decodeUnknownEither(ActivityPubPersonSchema)(person))).toBe(
            true
          )
        })
      )
    }))

  it.effect("rejects ActivityPub Person objects with wrong type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubPersonRequiredFieldsArbitrary, nonPersonTypeArbitrary, (person, type) => {
          expect(
            Either.isLeft(Schema.decodeUnknownEither(ActivityPubPersonSchema)({ ...person, type }))
          ).toBe(true)
        })
      )
    }))

  it.effect("rejects ActivityPub Person objects missing required fields", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubPersonMissingRequiredFieldsArbitrary, (person) => {
          expect(Either.isLeft(Schema.decodeUnknownEither(ActivityPubPersonSchema)(person))).toBe(
            true
          )
        })
      )
    }))

  it.effect("accepts ActivityPub OrderedCollection objects with required fields and correct type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubOrderedCollectionRequiredFieldsArbitrary, (collection) => {
          expect(
            Either.isRight(Schema.decodeUnknownEither(ActivityPubOrderedCollectionSchema)(collection))
          ).toBe(true)
        })
      )
    }))

  it.effect("rejects ActivityPub OrderedCollection objects with wrong type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          activityPubOrderedCollectionRequiredFieldsArbitrary,
          nonOrderedCollectionTypeArbitrary,
          (collection, type) => {
            expect(
              Either.isLeft(
                Schema.decodeUnknownEither(ActivityPubOrderedCollectionSchema)({
                  ...collection,
                  type
                })
              )
            ).toBe(true)
          }
        )
      )
    }))

  it.effect("rejects ActivityPub OrderedCollection objects missing required fields", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubOrderedCollectionMissingRequiredFieldsArbitrary, (collection) => {
          expect(
            Either.isLeft(Schema.decodeUnknownEither(ActivityPubOrderedCollectionSchema)(collection))
          ).toBe(true)
        })
      )
    }))

  it.effect("accepts ActivityPub OrderedCollectionPage objects with required fields and correct type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubOrderedCollectionPageRequiredFieldsArbitrary, (page) => {
          expect(
            Either.isRight(Schema.decodeUnknownEither(ActivityPubOrderedCollectionPageSchema)(page))
          ).toBe(true)
        })
      )
    }))

  it.effect("rejects ActivityPub OrderedCollectionPage objects with wrong type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          activityPubOrderedCollectionPageRequiredFieldsArbitrary,
          nonOrderedCollectionPageTypeArbitrary,
          (page, type) => {
            expect(
              Either.isLeft(
                Schema.decodeUnknownEither(ActivityPubOrderedCollectionPageSchema)({
                  ...page,
                  type
                })
              )
            ).toBe(true)
          }
        )
      )
    }))

  it.effect("rejects ActivityPub OrderedCollectionPage objects missing required fields", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubOrderedCollectionPageMissingRequiredFieldsArbitrary, (page) => {
          expect(
            Either.isLeft(Schema.decodeUnknownEither(ActivityPubOrderedCollectionPageSchema)(page))
          ).toBe(true)
        })
      )
    }))
})
