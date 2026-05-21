import * as Schema from "effect/Schema"

import {
  activityStreamsJsonLdContext,
  forgeFedJsonLdContext
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

export const ActivityForgeFedJsonLdContextSchema = Schema.Tuple(
  Schema.Literal(activityStreamsJsonLdContext),
  Schema.Literal(forgeFedJsonLdContext)
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
