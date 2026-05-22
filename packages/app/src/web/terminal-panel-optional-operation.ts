import { Effect, Either } from "effect"

export const runOptionalTerminalOperation = (operation: () => void): boolean =>
  Either.isRight(
    Effect.runSync(
      Effect.either(
        Effect.try({
          try: operation,
          catch: (error) => error
        })
      )
    )
  )
