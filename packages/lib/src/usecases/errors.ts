import type { PlatformError } from "@effect/platform/Error"
import { type ParseError } from "../core/domain.js"
import { formatParseError } from "../core/parse-errors.js"
import type {
  AuthError,
  CloneFailedError,
  CommandFailedError,
  ConfigDecodeError,
  ConfigNotFoundError,
  DockerAccessError,
  DockerCommandError,
  FileExistsError,
  InputCancelledError,
  InputReadError,
  PortProbeError,
  ScrapArchiveNotFoundError,
  ScrapTargetDirUnsupportedError,
  ScrapWipeRefusedError
} from "../shell/errors.js"

export type AppError =
  | ParseError
  | FileExistsError
  | CloneFailedError
  | DockerAccessError
  | DockerCommandError
  | ConfigNotFoundError
  | ConfigDecodeError
  | ScrapArchiveNotFoundError
  | ScrapTargetDirUnsupportedError
  | ScrapWipeRefusedError
  | InputCancelledError
  | InputReadError
  | PortProbeError
  | AuthError
  | CommandFailedError
  | PlatformError

type NonParseError = Exclude<AppError, ParseError>

const isParseError = (error: AppError): error is ParseError =>
  error._tag === "UnknownCommand" ||
  error._tag === "UnknownOption" ||
  error._tag === "MissingOptionValue" ||
  error._tag === "MissingRequiredOption" ||
  error._tag === "InvalidOption" ||
  error._tag === "UnexpectedArgument"

const renderDockerAccessHeadline = (issue: DockerAccessError["issue"]): string =>
  issue === "PermissionDenied"
    ? "Cannot access Docker daemon socket: permission denied."
    : "Cannot connect to Docker daemon."

const renderPrimaryError = (error: NonParseError): string | null => {
  if (error._tag === "FileExistsError") {
    return `File already exists: ${error.path} (use --force to overwrite)`
  }

  if (error._tag === "DockerCommandError") {
    return [
      `docker compose failed with exit code ${error.exitCode}`,
      "Hint: ensure Docker daemon is running and current user can access /var/run/docker.sock (for example via the docker group)."
    ].join("\n")
  }

  if (error._tag === "DockerAccessError") {
    return [
      renderDockerAccessHeadline(error.issue),
      "Hint: ensure Docker daemon is running and current user can access the docker socket.",
      "Hint: if you use rootless Docker, set DOCKER_HOST to your user socket (for example unix:///run/user/$UID/docker.sock).",
      `Details: ${error.details}`
    ].join("\n")
  }

  if (error._tag === "CloneFailedError") {
    return `Clone failed for ${error.repoUrl} (${error.repoRef}) into ${error.targetDir}`
  }

  if (error._tag === "PortProbeError") {
    return `SSH port check failed for ${error.port}: ${error.message}`
  }

  if (error._tag === "CommandFailedError") {
    return `${error.command} failed with exit code ${error.exitCode}`
  }

  if (error._tag === "ScrapArchiveNotFoundError") {
    return `Scrap archive not found: ${error.path} (run docker-git scrap export first)`
  }

  if (error._tag === "ScrapTargetDirUnsupportedError") {
    return [
      `Cannot use scrap with targetDir ${error.targetDir}.`,
      `Reason: ${error.reason}`,
      `Hint: scrap currently supports workspaces under /home/${error.sshUser}/... only.`
    ].join("\n")
  }

  if (error._tag === "ScrapWipeRefusedError") {
    return [
      `Refusing to wipe workspace for scrap import (targetDir ${error.targetDir}).`,
      `Reason: ${error.reason}`,
      "Hint: re-run with --no-wipe, or set a narrower --target-dir when creating the project."
    ].join("\n")
  }

  if (error._tag === "AuthError") {
    return error.message
  }

  return null
}

const renderConfigError = (error: NonParseError): string | null => {
  if (error._tag === "ConfigNotFoundError") {
    return `docker-git.json not found: ${error.path} (run docker-git create in that directory)`
  }

  if (error._tag === "ConfigDecodeError") {
    return `Invalid docker-git.json at ${error.path}: ${error.message}`
  }

  return null
}

const renderInputError = (error: NonParseError): string | null => {
  if (error._tag === "InputCancelledError") {
    return "Input cancelled."
  }

  if (error._tag === "InputReadError") {
    return `Input error: ${error.message}`
  }

  return null
}

const renderNonParseError = (error: NonParseError): string =>
  renderPrimaryError(error) ?? renderConfigError(error) ?? renderInputError(error) ?? error.message

// CHANGE: render typed application errors into user-facing text
// WHY: provide deterministic messaging for CLI and menu flows
// QUOTE(ТЗ): "вижу всю инфу по ним"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall e: render(e) = s -> deterministic(s)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: each AppError maps to exactly one message
// COMPLEXITY: O(1)
export const renderError = (error: AppError): string => {
  if (isParseError(error)) {
    return formatParseError(error)
  }

  return renderNonParseError(error)
}
