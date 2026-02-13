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

export type DockerAccessIssue = "PermissionDenied" | "DaemonUnavailable"

export class DockerAccessError extends Data.TaggedError("DockerAccessError")<{
  readonly issue: DockerAccessIssue
  readonly details: string
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

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string
}> {}

export class ScrapArchiveNotFoundError extends Data.TaggedError("ScrapArchiveNotFoundError")<{
  readonly path: string
}> {}

export class ScrapTargetDirUnsupportedError extends Data.TaggedError("ScrapTargetDirUnsupportedError")<{
  readonly sshUser: string
  readonly targetDir: string
  readonly reason: string
}> {}

export class ScrapWipeRefusedError extends Data.TaggedError("ScrapWipeRefusedError")<{
  readonly sshUser: string
  readonly targetDir: string
  readonly reason: string
}> {}
