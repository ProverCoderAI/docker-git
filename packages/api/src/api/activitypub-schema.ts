import * as Schema from "effect/Schema"

import {
  activityStreamsJsonLdContext,
  forgeFedJsonLdContext,
  securityJsonLdContext,
  socialWebWebfingerJsonLdContext
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
const JsonLdIdMappingSchema = Schema.Struct({
  "@id": Schema.String,
  "@type": OptionalString
}, Schema.Record({ key: Schema.String, value: JsonValueSchema }))

export const ActivityForgeFedJsonLdContextSchema = Schema.Tuple(
  Schema.Literal(activityStreamsJsonLdContext),
  Schema.Literal(forgeFedJsonLdContext)
)

export const LocalActorJsonLdContextSchema = Schema.Tuple(
  Schema.Literal(activityStreamsJsonLdContext),
  Schema.Literal(securityJsonLdContext),
  Schema.Literal(forgeFedJsonLdContext)
)

export const MastodonActorContextExtensionsSchema = Schema.Struct({
  manuallyApprovesFollowers: OptionalString,
  toot: OptionalString,
  featured: Schema.optional(JsonLdIdMappingSchema),
  featuredTags: Schema.optional(JsonLdIdMappingSchema),
  alsoKnownAs: Schema.optional(JsonLdIdMappingSchema),
  movedTo: Schema.optional(JsonLdIdMappingSchema),
  schema: OptionalString,
  PropertyValue: OptionalString,
  value: OptionalString,
  discoverable: OptionalString,
  suspended: OptionalString,
  memorial: OptionalString,
  indexable: OptionalString,
  attributionDomains: Schema.optional(JsonLdIdMappingSchema),
  showFeatured: OptionalString,
  showMedia: OptionalString,
  showRepliesInMedia: OptionalString,
  gts: OptionalString,
  interactionPolicy: Schema.optional(JsonLdIdMappingSchema),
  canQuote: Schema.optional(JsonLdIdMappingSchema),
  automaticApproval: Schema.optional(JsonLdIdMappingSchema),
  manualApproval: Schema.optional(JsonLdIdMappingSchema)
}, Schema.Record({ key: Schema.String, value: JsonValueSchema }))

export const MastodonActorJsonLdContextSchema = Schema.Tuple(
  Schema.Literal(activityStreamsJsonLdContext),
  Schema.Literal(securityJsonLdContext),
  Schema.Literal(socialWebWebfingerJsonLdContext),
  MastodonActorContextExtensionsSchema
)

export const ActorJsonLdContextSchema = Schema.Union(
  LocalActorJsonLdContextSchema,
  MastodonActorJsonLdContextSchema
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
  attachment: Schema.optional(Schema.Array(JsonValueSchema)),
  raw: Schema.optional(JsonValueSchema)
})

export const ActivityPubPublicKeySchema = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  publicKeyPem: Schema.String
})

const ActivityPubEndpointsSchema = Schema.Struct({
  sharedInbox: OptionalString
})

const ActivityPubImageSchema = Schema.Struct({
  type: Schema.Literal("Image"),
  mediaType: OptionalString,
  url: Schema.String,
  name: OptionalString
})

const ActivityPubActorAttachmentSchema = Schema.Struct({
  type: Schema.Literal("PropertyValue"),
  name: Schema.String,
  value: Schema.String
})

const ActivityPubHashtagTagSchema = Schema.Struct({
  type: Schema.Literal("Hashtag"),
  name: Schema.String,
  href: Schema.String
})

const ActivityPubEmojiTagSchema = Schema.Struct({
  type: Schema.Literal("Emoji"),
  id: Schema.String,
  name: Schema.String,
  icon: ActivityPubImageSchema,
  updated: OptionalString
})

const ActivityPubActorTagSchema = Schema.Union(
  ActivityPubHashtagTagSchema,
  ActivityPubEmojiTagSchema
)

const ActivityPubInteractionApprovalSchema = Schema.Struct({
  automaticApproval: Schema.optional(Schema.Array(Schema.String)),
  manualApproval: Schema.optional(Schema.Array(Schema.String))
}).pipe(
  Schema.filter((approval) =>
    approval.automaticApproval !== undefined ||
    approval.manualApproval !== undefined)
)

const MastodonInteractionPolicySchema = Schema.Struct({
  canFeature: Schema.optional(ActivityPubInteractionApprovalSchema),
  canQuote: Schema.optional(ActivityPubInteractionApprovalSchema)
}).pipe(
  Schema.filter((policy) =>
    policy.canFeature !== undefined ||
    policy.canQuote !== undefined)
)

export const ActivityPubPersonSchema = Schema.Struct({
  "@context": ActorJsonLdContextSchema,
  type: Schema.Literal("Person"),
  id: Schema.String,
  name: OptionalString,
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
  alsoKnownAs: Schema.optional(Schema.Array(Schema.String)),
  movedTo: OptionalString,
  suspended: OptionalBoolean,
  attributionDomains: Schema.optional(Schema.Array(Schema.String)),
  icon: Schema.optional(ActivityPubImageSchema),
  image: Schema.optional(ActivityPubImageSchema),
  devices: OptionalString,
  showFeatured: OptionalBoolean,
  showMedia: OptionalBoolean,
  showRepliesInMedia: OptionalBoolean,
  interactionPolicy: Schema.optional(MastodonInteractionPolicySchema),
  featuredCollections: OptionalString,
  tag: Schema.optional(Schema.Array(ActivityPubActorTagSchema)),
  attachment: Schema.optional(Schema.Array(ActivityPubActorAttachmentSchema))
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
  orderedItems: Schema.optionalWith(Schema.Array(JsonValueSchema), { default: () => [] })
})

export const ActivityPubOrderedCollectionPageSchema = Schema.Struct({
  "@context": JsonLdContextSchema,
  type: Schema.Literal("OrderedCollectionPage"),
  id: Schema.String,
  totalItems: Schema.Number,
  partOf: Schema.String,
  next: OptionalString,
  prev: OptionalString,
  orderedItems: Schema.Array(JsonValueSchema)
})
