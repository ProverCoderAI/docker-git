import * as S from "@effect/schema/Schema"
import { Effect, pipe } from "effect"

import type { GreetingVariant } from "../core/greeting.js"

const cliSchema = S.Struct({
  name: S.optionalWith(S.NonEmptyString, { default: () => "Effect" })
})

type CliInput = S.Schema.Type<typeof cliSchema>

const toVariant = (input: CliInput): GreetingVariant =>
  input.name.toLowerCase() === "effect"
    ? { kind: "effect" }
    : { kind: "named", name: input.name }

export const readGreetingVariant = pipe(
  Effect.sync(() => process.argv.slice(2)),
  Effect.map((args) => args.length > 0 && args[0] !== undefined ? { name: args[0] } : {}),
  Effect.flatMap(S.decodeUnknown(cliSchema)),
  Effect.map((input) => toVariant(input))
)
