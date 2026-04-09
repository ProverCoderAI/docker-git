import * as Schema from "@effect/schema/Schema"

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
