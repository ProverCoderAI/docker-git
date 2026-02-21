import { Data } from "effect"

export class ApiBadRequestError extends Data.TaggedError("ApiBadRequestError")<{
  readonly message: string
  readonly details?: unknown
}> {}

export class ApiNotFoundError extends Data.TaggedError("ApiNotFoundError")<{
  readonly message: string
}> {}

export class ApiConflictError extends Data.TaggedError("ApiConflictError")<{
  readonly message: string
}> {}

export class ApiInternalError extends Data.TaggedError("ApiInternalError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export type ApiKnownError =
  | ApiBadRequestError
  | ApiNotFoundError
  | ApiConflictError
  | ApiInternalError

export const describeUnknown = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)
