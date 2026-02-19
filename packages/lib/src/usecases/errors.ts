import type { PlatformError } from "@effect/platform/Error"
import { Match } from "effect"
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
  ScrapArchiveInvalidError,
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
  | ScrapArchiveInvalidError
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

const renderPrimaryError = (error: NonParseError): string | null =>
  Match.value(error).pipe(
    Match.when({ _tag: "FileExistsError" }, ({ path }) => `File already exists: ${path} (use --force to overwrite)`),
    Match.when({ _tag: "DockerCommandError" }, ({ exitCode }) =>
      [
        `docker compose failed with exit code ${exitCode}`,
        "Hint: ensure Docker daemon is running and current user can access /var/run/docker.sock (for example via the docker group).",
        "Hint: if output above contains 'port is already allocated', retry with a free SSH port via --ssh-port <port> (for example --ssh-port 2235), or stop the conflicting project/container."
      ].join("\n")),
    Match.when({ _tag: "DockerAccessError" }, ({ details, issue }) =>
      [
        renderDockerAccessHeadline(issue),
        "Hint: ensure Docker daemon is running and current user can access the docker socket.",
        "Hint: if you use rootless Docker, set DOCKER_HOST to your user socket (for example unix:///run/user/$UID/docker.sock).",
        `Details: ${details}`
      ].join("\n")),
    Match.when({ _tag: "CloneFailedError" }, ({ repoRef, repoUrl, targetDir }) =>
      `Clone failed for ${repoUrl} (${repoRef}) into ${targetDir}`),
    Match.when({ _tag: "PortProbeError" }, ({ message, port }) =>
      `SSH port check failed for ${port}: ${message}`),
    Match.when(
      { _tag: "CommandFailedError" },
      ({ command, exitCode }) => `${command} failed with exit code ${exitCode}`
    ),
    Match.when(
      { _tag: "ScrapArchiveNotFoundError" },
      ({ path }) => `Scrap archive not found: ${path} (run docker-git scrap export first)`
    ),
    Match.when(
      { _tag: "ScrapArchiveInvalidError" },
      ({ message, path }) => `Invalid scrap archive: ${path}\nDetails: ${message}`
    ),
    Match.when({ _tag: "ScrapTargetDirUnsupportedError" }, ({ reason, sshUser, targetDir }) =>
      [
        `Cannot use scrap with targetDir ${targetDir}.`,
        `Reason: ${reason}`,
        `Hint: scrap currently supports workspaces under /home/${sshUser}/... only.`
      ].join("\n")),
    Match.when({ _tag: "ScrapWipeRefusedError" }, ({ reason, targetDir }) =>
      [
        `Refusing to wipe workspace for scrap import (targetDir ${targetDir}).`,
        `Reason: ${reason}`,
        "Hint: re-run with --no-wipe, or set a narrower --target-dir when creating the project."
      ].join("\n")),
    Match.when({ _tag: "AuthError" }, ({ message }) => message),
    Match.orElse(() => null)
  )

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
