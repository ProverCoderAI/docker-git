import { Data } from "effect"

export class ProjectNotFoundError extends Data.TaggedError("ProjectNotFoundError")<{
  readonly id: string
  readonly root: string
}> {}

export class StaticAssetNotFoundError extends Data.TaggedError("StaticAssetNotFoundError")<{
  readonly path: string
}> {}
