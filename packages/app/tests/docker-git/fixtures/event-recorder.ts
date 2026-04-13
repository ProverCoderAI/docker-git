import { Effect } from "effect"

export const recordEvent = (events: Array<string>, entry: string): Effect.Effect<void> =>
  Effect.sync(() => {
    events.push(entry)
  })
