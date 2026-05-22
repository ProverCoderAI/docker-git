import { Effect, type Either } from "effect"

type OptionalTerminalOperationError = {
  readonly _tag: "OptionalTerminalOperationError"
  readonly message: string
}

export type OptionalTerminalOperationResult = Either.Either<void, OptionalTerminalOperationError>

export const runOptionalTerminalOperation = (operation: () => void): OptionalTerminalOperationResult =>
  Effect.runSync(
    Effect.either(
      Effect.try({
        try: operation,
        catch: (error) => ({
          _tag: "OptionalTerminalOperationError",
          message: String(error)
        })
      })
    )
  )
