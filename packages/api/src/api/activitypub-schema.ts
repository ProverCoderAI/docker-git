import * as Schema from "effect/Schema"

import {
  activityStreamsJsonLdContext,
  forgeFedJsonLdContext,
  securityJsonLdContext
} from "./contracts.js"

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonObject | ReadonlyArray<JsonValue>
export type JsonObject = Readonly<{ [key: string]: JsonValue }>

export const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema })
  )
)

const OptionalString = Schema.optional(Schema.String)
const OptionalBoolean = Schema.optional(Schema.Boolean)
const JsonObjectSchema = Schema.Record({ key: Schema.String, value: JsonValueSchema })
const JsonLdContextEntrySchema = Schema.Union(Schema.String, JsonObjectSchema)

export const ActivityForgeFedJsonLdContextSchema = Schema.Tuple(
  Schema.Literal(activityStreamsJsonLdContext),
  Schema.Literal(forgeFedJsonLdContext)
)

export const ActorJsonLdContextSchema = Schema.Tuple(
  Schema.Literal(activityStreamsJsonLdContext),
  Schema.Literal(securityJsonLdContext),
  Schema.Literal(forgeFedJsonLdContext)
)

export const JsonLdContextSchema = Schema.Union(
  Schema.String,
  JsonObjectSchema,
  Schema.Array(JsonLdContextEntrySchema)
)

export const ForgeFedTicketSourceSchema = Schema.Struct({
  content: OptionalString,
  mediaType: OptionalString
})

export const ForgeFedTicketSchema = Schema.Struct({
  id: Schema.String,
  attributedTo: Schema.String,
  summary: Schema.String,
  content: Schema.String,
  mediaType: OptionalString,
  source: Schema.optional(Schema.Union(Schema.String, ForgeFedTicketSourceSchema)),
  published: OptionalString,
  updated: OptionalString,
  url: OptionalString,
  context: OptionalString,
  workType: OptionalString,
  attachment: Schema.optional(Schema.Array(Schema.Unknown)),
  raw: Schema.optional(Schema.Unknown)
})

export const ActivityPubPublicKeySchema = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  publicKeyPem: Schema.String
})

const ActivityPubEndpointsSchema = Schema.Struct({
  sharedInbox: OptionalString
})

const ActivityPubInteractionPolicySchema = Schema.Record({
  key: Schema.String,
  value: JsonValueSchema
})

export const ActivityPubPersonSchema = Schema.Struct({
  "@context": JsonLdContextSchema,
  type: Schema.Literal("Person"),
  id: Schema.String,
  name: Schema.String,
  preferredUsername: Schema.String,
  summary: Schema.String,
  inbox: Schema.String,
  outbox: Schema.String,
  followers: Schema.String,
  following: Schema.String,
  liked: OptionalString,
  publicKey: Schema.optional(ActivityPubPublicKeySchema),
  endpoints: Schema.optional(ActivityPubEndpointsSchema),
  webfinger: OptionalString,
  featured: OptionalString,
  featuredTags: OptionalString,
  url: OptionalString,
  manuallyApprovesFollowers: OptionalBoolean,
  discoverable: OptionalBoolean,
  indexable: OptionalBoolean,
  published: OptionalString,
  memorial: OptionalBoolean,
  showFeatured: OptionalBoolean,
  showMedia: OptionalBoolean,
  showRepliesInMedia: OptionalBoolean,
  interactionPolicy: Schema.optional(ActivityPubInteractionPolicySchema),
  featuredCollections: OptionalString,
  tag: Schema.optional(Schema.Array(JsonValueSchema)),
  attachment: Schema.optional(Schema.Array(JsonValueSchema))
})

export const ActivityPubFollowActivitySchema = Schema.Struct({
  "@context": ActivityForgeFedJsonLdContextSchema,
  id: Schema.String,
  type: Schema.Literal("Follow"),
  actor: Schema.String,
  object: Schema.String,
  to: Schema.optional(Schema.Array(Schema.String)),
  capability: OptionalString
})

export const ActivityPubOrderedCollectionSchema = Schema.Struct({
  "@context": JsonLdContextSchema,
  type: Schema.Literal("OrderedCollection"),
  id: Schema.String,
  totalItems: Schema.Number,
  first: OptionalString,
  last: OptionalString,
  current: OptionalString,
  orderedItems: Schema.optionalWith(Schema.Array(Schema.Unknown), { default: () => [] })
})

export const ActivityPubOrderedCollectionPageSchema = Schema.Struct({
  "@context": JsonLdContextSchema,
  type: Schema.Literal("OrderedCollectionPage"),
  id: Schema.String,
  totalItems: Schema.Number,
  partOf: Schema.String,
  next: OptionalString,
  prev: OptionalString,
  orderedItems: Schema.Array(Schema.Unknown)
})
