import { describe, expect, it } from "@effect/vitest"
import { Effect, Either, ParseResult, Schema } from "effect"
import fc from "fast-check"

import {
  ActivityPubOrderedCollectionPageSchema,
  ActivityPubOrderedCollectionSchema,
  ActivityPubPersonSchema,
  exactActivityPubParseOptions
} from "../src/api/schema.js"

const decodeActivityPubEither = <A, I>(schema: Schema.Schema<A, I, never>, value: unknown) =>
  Schema.decodeUnknownEither(schema, exactActivityPubParseOptions)(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const expectDecodedMatchesFixtureKeys = (decoded: object, fixture: object): void => {
  expect(Object.keys(decoded).sort()).toEqual(Object.keys(fixture).sort())
}

const activityForgeFedContextArbitrary = fc.constant([
  "https://www.w3.org/ns/activitystreams",
  "https://forgefed.org/ns"
] as const)

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

const activityPubPublicKeyArbitrary = fc.record({
  id: schemaStringArbitrary,
  owner: schemaStringArbitrary,
  publicKeyPem: schemaStringArbitrary
})

const activityPubEndpointsArbitrary = fc.record({
  sharedInbox: schemaStringArbitrary
})

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
  following: schemaStringArbitrary,
  liked: schemaStringArbitrary,
  publicKey: activityPubPublicKeyArbitrary,
  endpoints: activityPubEndpointsArbitrary
})

const activityPubPersonMissingRequiredFieldsArbitrary = fc.record({
  "@context": activityPubActorContextArbitrary,
  type: fc.constant("Person"),
  id: schemaStringArbitrary
})

const activityPubOrderedCollectionRequiredFieldsArbitrary = fc.record({
  "@context": activityForgeFedContextArbitrary,
  type: fc.constant("OrderedCollection"),
  id: schemaStringArbitrary,
  totalItems: fc.integer({ min: 0 }),
  orderedItems: fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)))
})

const activityPubOrderedCollectionMissingRequiredFieldsArbitrary = fc.record({
  "@context": activityForgeFedContextArbitrary,
  type: fc.constant("OrderedCollection"),
  id: schemaStringArbitrary,
  totalItems: fc.integer({ min: 0 })
})

const activityPubOrderedCollectionPageRequiredFieldsArbitrary = fc.record({
  "@context": activityForgeFedContextArbitrary,
  type: fc.constant("OrderedCollectionPage"),
  id: schemaStringArbitrary,
  totalItems: fc.integer({ min: 0 }),
  partOf: schemaStringArbitrary,
  orderedItems: fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)))
})

const activityPubOrderedCollectionPageMissingRequiredFieldsArbitrary = fc.record({
  "@context": activityForgeFedContextArbitrary,
  type: fc.constant("OrderedCollectionPage"),
  id: schemaStringArbitrary,
  totalItems: fc.integer({ min: 0 }),
  orderedItems: fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)))
})

const mastodonActorContextExtensionsFixture = {
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

const mastodonActorContextFixture = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  "https://purl.archive.org/socialweb/webfinger",
  mastodonActorContextExtensionsFixture
] as const

const mastodonActorFixture = {
  "@context": mastodonActorContextFixture,
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
    "https://mastodon.social/users/example"
  ]
}

const mastodonActorWithContextExtensions = (
  extensions: unknown
): object => ({
  ...mastodonActorFixture,
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    "https://purl.archive.org/socialweb/webfinger",
    extensions
  ]
})

describe("ActivityPub and ForgeFed schema parity", () => {
  it.effect("decodes a Mastodon actor Person fixture", () =>
    Effect.sync(() => {
      const result = decodeActivityPubEither(ActivityPubPersonSchema, mastodonActorFixture)

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (decoded) => {
          expectDecodedMatchesFixtureKeys(decoded, mastodonActorFixture)
          const decodedContext = Reflect.get(decoded, "@context")
          expect(Array.isArray(decodedContext)).toBe(true)
          if (!Array.isArray(decodedContext)) {
            throw new Error("Decoded Mastodon actor context is not an array.")
          }
          const decodedExtensions = decodedContext[3]
          expect(isRecord(decodedExtensions)).toBe(true)
          if (!isRecord(decodedExtensions)) {
            throw new Error("Decoded Mastodon actor context extensions are not an object.")
          }
          expect(Object.keys(decodedExtensions).sort()).toEqual(
            Object.keys(mastodonActorContextExtensionsFixture).sort()
          )
        }
      })
    }))

  it.effect("decodes a Mastodon followers OrderedCollection fixture", () =>
    Effect.sync(() => {
      const result = decodeActivityPubEither(
        ActivityPubOrderedCollectionSchema,
        mastodonFollowersCollectionFixture
      )

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (decoded) => {
          expectDecodedMatchesFixtureKeys(decoded, mastodonFollowersCollectionFixture)
        }
      })
    }))

  it.effect("decodes a Mastodon followers OrderedCollectionPage fixture", () =>
    Effect.sync(() => {
      const result = decodeActivityPubEither(
        ActivityPubOrderedCollectionPageSchema,
        mastodonFollowersPageFixture
      )

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (decoded) => {
          expectDecodedMatchesFixtureKeys(decoded, mastodonFollowersPageFixture)
        }
      })
    }))

  it.effect("rejects ActivityPub objects with wrong literal types", () =>
    Effect.sync(() => {
      const personResult = decodeActivityPubEither(ActivityPubPersonSchema, {
        ...mastodonActorFixture,
        type: "Service"
      })
      const collectionResult = decodeActivityPubEither(ActivityPubOrderedCollectionSchema, {
        ...mastodonFollowersCollectionFixture,
        type: "Collection"
      })
      const pageResult = decodeActivityPubEither(ActivityPubOrderedCollectionPageSchema, {
        ...mastodonFollowersPageFixture,
        type: "OrderedCollection"
      })

      expect(Either.isLeft(personResult)).toBe(true)
      expect(Either.isLeft(collectionResult)).toBe(true)
      expect(Either.isLeft(pageResult)).toBe(true)
    }))

  it.effect("rejects ActivityPub objects missing required fields", () =>
    Effect.sync(() => {
      const personResult = decodeActivityPubEither(ActivityPubPersonSchema, {
        type: "Person",
        id: "https://mastodon.social/users/missing"
      })
      const collectionResult = decodeActivityPubEither(ActivityPubOrderedCollectionSchema, {
        type: "OrderedCollection",
        id: "https://mastodon.social/users/nixCraft/followers"
      })
      const pageResult = decodeActivityPubEither(ActivityPubOrderedCollectionPageSchema, {
        type: "OrderedCollectionPage",
        id: "https://mastodon.social/users/nixCraft/followers?page=1",
        orderedItems: []
      })

      expect(Either.isLeft(personResult)).toBe(true)
      expect(Either.isLeft(collectionResult)).toBe(true)
      expect(Either.isLeft(pageResult)).toBe(true)
    }))

  it.effect("accepts structured ActivityPub Person actor tag and attachment values", () =>
    Effect.sync(() => {
      const result = decodeActivityPubEither(ActivityPubPersonSchema, {
        ...mastodonActorFixture,
        tag: [
          {
            type: "Hashtag",
            name: "#activitypub",
            href: "https://mastodon.social/tags/activitypub"
          },
          {
            type: "Emoji",
            id: "https://mastodon.social/emojis/party",
            name: ":party:",
            updated: "2026-05-21T00:00:00Z",
            icon: {
              type: "Image",
              mediaType: "image/png",
              url: "https://mastodon.social/system/custom_emojis/images/party.png"
            }
          }
        ],
        attachment: [
          {
            type: "PropertyValue",
            name: "Website",
            value: "<a href=\"https://example.com\">https://example.com</a>"
          }
        ]
      })

      expect(Either.isRight(result)).toBe(true)
    }))

  it.effect("rejects structurally invalid ActivityPub Person actor extensions", () =>
    Effect.sync(() => {
      const invalidActors = [
        { ...mastodonActorFixture, icon: {} },
        { ...mastodonActorFixture, image: { type: "Image" } },
        { ...mastodonActorFixture, tag: [{}] },
        {
          ...mastodonActorFixture,
          tag: [{ type: "Emoji", id: "https://mastodon.social/emojis/party", name: ":party:" }]
        },
        { ...mastodonActorFixture, attachment: [{}] },
        {
          ...mastodonActorFixture,
          attachment: [{ type: "Note", name: "Website", value: "https://example.com" }]
        },
        { ...mastodonActorFixture, interactionPolicy: {} },
        { ...mastodonActorFixture, interactionPolicy: { arbitrary: true } },
        { ...mastodonActorFixture, interactionPolicy: { canFeature: { arbitrary: true } } }
      ]

      invalidActors.forEach((actor) => {
        expect(Either.isLeft(decodeActivityPubEither(ActivityPubPersonSchema, actor))).toBe(true)
      })
    }))

  it.effect("rejects non-exact ActivityPub fixture shapes", () =>
    Effect.sync(() => {
      const contextWithoutManualApproval = Object.fromEntries(
        Object.entries(mastodonActorContextExtensionsFixture).filter(
          ([key]) => key !== "manualApproval"
        )
      )
      const contextWithFeaturedWithoutType = {
        ...mastodonActorContextExtensionsFixture,
        featured: {
          "@id": mastodonActorContextExtensionsFixture.featured["@id"]
        }
      }
      const contextWithExtraKey = {
        ...mastodonActorContextExtensionsFixture,
        extraContextTerm: "toot:extraContextTerm"
      }
      const invalidDocuments = [
        { ...mastodonActorFixture, extraField: "not in the issue fixture" },
        mastodonActorWithContextExtensions(contextWithoutManualApproval),
        mastodonActorWithContextExtensions(contextWithFeaturedWithoutType),
        mastodonActorWithContextExtensions(contextWithExtraKey),
        { ...mastodonFollowersCollectionFixture, orderedItems: [] },
        { ...mastodonFollowersPageFixture, prev: "https://mastodon.social/users/nixCraft/followers" },
        { ...mastodonFollowersPageFixture, orderedItems: ["ok", { id: "not-a-link" }] }
      ]

      invalidDocuments.slice(0, 4).forEach((document) => {
        expect(Either.isLeft(decodeActivityPubEither(ActivityPubPersonSchema, document))).toBe(true)
      })
      expect(
        Either.isLeft(decodeActivityPubEither(ActivityPubOrderedCollectionSchema, invalidDocuments[4]))
      ).toBe(true)
      expect(
        Either.isLeft(decodeActivityPubEither(ActivityPubOrderedCollectionPageSchema, invalidDocuments[5]))
      ).toBe(true)
      expect(
        Either.isLeft(decodeActivityPubEither(ActivityPubOrderedCollectionPageSchema, invalidDocuments[6]))
      ).toBe(true)
    }))

  it.effect("accepts ActivityPub Person objects with required fields and correct type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubPersonRequiredFieldsArbitrary, (person) => {
          expect(Either.isRight(decodeActivityPubEither(ActivityPubPersonSchema, person))).toBe(true)
        })
      )
    }))

  it.effect("rejects ActivityPub Person objects with wrong type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubPersonRequiredFieldsArbitrary, nonPersonTypeArbitrary, (person, type) => {
          expect(
            Either.isLeft(decodeActivityPubEither(ActivityPubPersonSchema, { ...person, type }))
          ).toBe(true)
        })
      )
    }))

  it.effect("rejects ActivityPub Person objects missing required fields", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubPersonMissingRequiredFieldsArbitrary, (person) => {
          expect(Either.isLeft(decodeActivityPubEither(ActivityPubPersonSchema, person))).toBe(true)
        })
      )
    }))

  it.effect("accepts ActivityPub OrderedCollection objects with required fields and correct type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubOrderedCollectionRequiredFieldsArbitrary, (collection) => {
          expect(
            Either.isRight(decodeActivityPubEither(ActivityPubOrderedCollectionSchema, collection))
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
                decodeActivityPubEither(ActivityPubOrderedCollectionSchema, {
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
            Either.isLeft(decodeActivityPubEither(ActivityPubOrderedCollectionSchema, collection))
          ).toBe(true)
        })
      )
    }))

  it.effect("accepts ActivityPub OrderedCollectionPage objects with required fields and correct type", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(activityPubOrderedCollectionPageRequiredFieldsArbitrary, (page) => {
          expect(
            Either.isRight(decodeActivityPubEither(ActivityPubOrderedCollectionPageSchema, page))
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
                decodeActivityPubEither(ActivityPubOrderedCollectionPageSchema, {
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
            Either.isLeft(decodeActivityPubEither(ActivityPubOrderedCollectionPageSchema, page))
          ).toBe(true)
        })
      )
    }))
})
