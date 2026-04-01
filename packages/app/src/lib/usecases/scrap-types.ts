import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"

import type {
  CommandFailedError,
  ConfigDecodeError,
  ConfigNotFoundError,
  DockerAccessError,
  ScrapArchiveInvalidError,
  ScrapArchiveNotFoundError,
  ScrapTargetDirUnsupportedError,
  ScrapWipeRefusedError
} from "../shell/errors.js"

export type ScrapError =
  | ScrapArchiveInvalidError
  | ScrapArchiveNotFoundError
  | ScrapTargetDirUnsupportedError
  | ScrapWipeRefusedError
  | ConfigNotFoundError
  | ConfigDecodeError
  | DockerAccessError
  | CommandFailedError
  | PlatformError

export type ScrapRequirements = Fs | PathService | CommandExecutor.CommandExecutor
