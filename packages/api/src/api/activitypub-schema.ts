import * as Schema from "effect/Schema"
import type * as SchemaAST from "effect/SchemaAST"

import {
  activityStreamsJsonLdContext,
  forgeFedJsonLdContext,
  securityJsonLdContext,
  socialWebWebfingerJsonLdContext
} from "./contracts.js"

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonObject | ReadonlyArray<JsonValue>
export type JsonObject = Readonly<{ [key: string]: JsonValue }>

export const exactActivityPubParseOptions: SchemaAST.ParseOptions = {
  onExcessProperty: "error"
}

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
const JsonObjectSchema = Schema.Record({ key: Schema.String, value: JsonValueSchema })
const JsonLdContextEntrySchema = Schema.Union(Schema.String, JsonObjectSchema)
const JsonLdIdMappingSchema = Schema.Struct({
  "@id": Schema.String,
  "@type": Schema.Literal("@id")
})

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
  manuallyApprovesFollowers: Schema.String,
  toot: Schema.String,
  featured: JsonLdIdMappingSchema,
  featuredTags: JsonLdIdMappingSchema,
  alsoKnownAs: JsonLdIdMappingSchema,
  movedTo: JsonLdIdMappingSchema,
  schema: Schema.String,
  PropertyValue: Schema.String,
  value: Schema.String,
  discoverable: Schema.String,
  suspended: Schema.String,
  memorial: Schema.String,
  indexable: Schema.String,
  attributionDomains: JsonLdIdMappingSchema,
  showFeatured: Schema.String,
  showMedia: Schema.String,
  showRepliesInMedia: Schema.String,
  gts: Schema.String,
  interactionPolicy: JsonLdIdMappingSchema,
  canQuote: JsonLdIdMappingSchema,
  automaticApproval: JsonLdIdMappingSchema,
  manualApproval: JsonLdIdMappingSchema
})

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
  sharedInbox: Schema.String
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

export const LocalActivityPubPersonSchema = Schema.Struct({
  "@context": LocalActorJsonLdContextSchema,
  type: Schema.Literal("Person"),
  id: Schema.String,
  name: Schema.String,
  preferredUsername: Schema.String,
  summary: Schema.String,
  inbox: Schema.String,
  outbox: Schema.String,
  followers: Schema.String,
  following: Schema.String,
  liked: Schema.String,
  publicKey: ActivityPubPublicKeySchema,
  endpoints: ActivityPubEndpointsSchema
})

export const MastodonIssueActivityPubPersonSchema = Schema.Struct({
  "@context": MastodonActorJsonLdContextSchema,
  id: Schema.String,
  webfinger: Schema.String,
  type: Schema.Literal("Person"),
  following: Schema.String,
  followers: Schema.String,
  inbox: Schema.String,
  outbox: Schema.String,
  featured: Schema.String,
  featuredTags: Schema.String,
  preferredUsername: Schema.String,
  name: Schema.String,
  summary: Schema.String,
  url: Schema.String,
  manuallyApprovesFollowers: Schema.Boolean,
  discoverable: Schema.Boolean,
  indexable: Schema.Boolean,
  published: Schema.String,
  memorial: Schema.Boolean,
  showFeatured: Schema.Boolean,
  showMedia: Schema.Boolean,
  showRepliesInMedia: Schema.Boolean,
  interactionPolicy: MastodonInteractionPolicySchema,
  featuredCollections: Schema.String,
  publicKey: ActivityPubPublicKeySchema,
  tag: Schema.Array(ActivityPubActorTagSchema),
  attachment: Schema.Array(ActivityPubActorAttachmentSchema),
  endpoints: ActivityPubEndpointsSchema
})

export const ActivityPubPersonSchema = Schema.Union(
  LocalActivityPubPersonSchema,
  MastodonIssueActivityPubPersonSchema
)

export const ActivityPubFollowActivitySchema = Schema.Struct({
  "@context": ActivityForgeFedJsonLdContextSchema,
  id: Schema.String,
  type: Schema.Literal("Follow"),
  actor: Schema.String,
  object: Schema.String,
  to: Schema.optional(Schema.Array(Schema.String)),
  capability: OptionalString
})

export const LocalActivityPubOrderedCollectionSchema = Schema.Struct({
  "@context": ActivityForgeFedJsonLdContextSchema,
  type: Schema.Literal("OrderedCollection"),
  id: Schema.String,
  totalItems: Schema.Number,
  orderedItems: Schema.Array(JsonValueSchema)
})

export const LocalActivityPubFollowersCollectionSchema = Schema.Struct({
  "@context": ActivityForgeFedJsonLdContextSchema,
  type: Schema.Literal("OrderedCollection"),
  id: Schema.String,
  totalItems: Schema.Number,
  first: Schema.String,
  orderedItems: Schema.Array(JsonValueSchema)
})

export const MastodonFollowersOrderedCollectionSchema = Schema.Struct({
  "@context": Schema.Literal(activityStreamsJsonLdContext),
  id: Schema.String,
  type: Schema.Literal("OrderedCollection"),
  totalItems: Schema.Number,
  first: Schema.String
})

export const ActivityPubOrderedCollectionSchema = Schema.Union(
  LocalActivityPubOrderedCollectionSchema,
  LocalActivityPubFollowersCollectionSchema,
  MastodonFollowersOrderedCollectionSchema
)

export const LocalActivityPubOrderedCollectionPageSchema = Schema.Struct({
  "@context": ActivityForgeFedJsonLdContextSchema,
  type: Schema.Literal("OrderedCollectionPage"),
  id: Schema.String,
  totalItems: Schema.Number,
  partOf: Schema.String,
  orderedItems: Schema.Array(JsonValueSchema)
})

export const MastodonFollowersOrderedCollectionPageSchema = Schema.Struct({
  "@context": Schema.Literal(activityStreamsJsonLdContext),
  id: Schema.String,
  type: Schema.Literal("OrderedCollectionPage"),
  totalItems: Schema.Number,
  partOf: Schema.String,
  next: Schema.String,
  orderedItems: Schema.Array(Schema.String)
})

export const ActivityPubOrderedCollectionPageSchema = Schema.Union(
  LocalActivityPubOrderedCollectionPageSchema,
  MastodonFollowersOrderedCollectionPageSchema
)
