import { Data } from "effect"

export class FileExistsError extends Data.TaggedError("FileExistsError")<{
  readonly path: string
}> {}

export class ConfigNotFoundError extends Data.TaggedError("ConfigNotFoundError")<{
  readonly path: string
}> {}

export class ConfigDecodeError extends Data.TaggedError("ConfigDecodeError")<{
  readonly path: string
  readonly message: string
}> {}

export class InputCancelledError extends Data.TaggedError("InputCancelledError")<
  Record<string, never>
> {}

export class InputReadError extends Data.TaggedError("InputReadError")<{
  readonly message: string
}> {}

export class DockerCommandError extends Data.TaggedError("DockerCommandError")<{
  readonly exitCode: number
}> {}

export class CloneFailedError extends Data.TaggedError("CloneFailedError")<{
  readonly repoUrl: string
  readonly repoRef: string
  readonly targetDir: string
}> {}

export class PortProbeError extends Data.TaggedError("PortProbeError")<{
  readonly port: number
  readonly message: string
}> {}

export class CommandFailedError extends Data.TaggedError("CommandFailedError")<{
  readonly command: string
  readonly exitCode: number
}> {}
