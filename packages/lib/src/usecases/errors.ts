import type { PlatformError } from "@effect/platform/Error"
import { Match } from "effect"
import { type ParseError } from "../core/domain.js"
import { isNvidiaRuntimeFailure } from "../core/gpu.js"
import { formatParseError } from "../core/parse-errors.js"
import type {
  AgentFailedError,
  AuthError,
  CloneFailedError,
  CommandFailedError,
  ConfigDecodeError,
  ConfigNotFoundError,
  DockerAccessError,
  DockerCommandError,
  DockerIdentityConflictError,
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
  | AgentFailedError
  | DockerAccessError
  | DockerCommandError
  | DockerIdentityConflictError
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

const renderDockerAccessActionPlan = (issue: DockerAccessError["issue"]): string => {
  const permissionDeniedPlan = [
    "Action plan:",
    "1) In the same shell, run: `groups $USER` and make sure group `docker` is present.",
    "2) Re-login to refresh group memberships and run command again.",
    "3) If DOCKER_HOST is set to rootless socket, keep running: `export DOCKER_HOST=unix:///run/user/$UID/docker.sock`.",
    "4) If using a dedicated socket not in /run/user, set DOCKER_HOST explicitly and re-run.",
    "Tip: this app now auto-tries a rootless socket fallback on first permission error."
  ]

  const daemonUnavailablePlan = [
    "Action plan:",
    "1) Check daemon status: `systemctl --user status docker` or `systemctl status docker`.",
    "2) Start daemon: `systemctl --user start docker` (or `systemctl start docker` for system Docker).",
    "3) Retry command in a new shell."
  ]

  return issue === "PermissionDenied" ? permissionDeniedPlan.join("\n") : daemonUnavailablePlan.join("\n")
}

// CHANGE: classify Docker build apt signature noise that is commonly caused by storage exhaustion.
// WHY: when Docker's backing filesystem is full, apt can report every repository as "not signed"; surfacing disk-pressure recovery avoids chasing false GPG/key fixes.
// QUOTE(ТЗ): "Все пробелмы с котоырми ты сталкиваешься должны быть потом покрыты тестами"
// REF: runtime-2026-05-14-docker-disk-full
// SOURCE: n/a
// FORMAT THEOREM: contains_apt_invalid_signature(details) -> render_error(details) includes disk_space_recovery_hint
// PURITY: CORE
// INVARIANT: the classifier only adds guidance and does not alter command execution semantics
// COMPLEXITY: O(n) time / O(1) space where n = |details|.
const isAptInvalidSignatureFailure = (details: string | undefined): boolean => {
  const normalized = details?.toLowerCase() ?? ""
  return normalized.includes("apt-get update failed") &&
    normalized.includes("invalid signature") &&
    normalized.includes("repository") &&
    normalized.includes("not signed")
}

const renderDockerCommandError = ({ details, exitCode }: DockerCommandError): string =>
  [
    `docker compose failed with exit code ${exitCode}`,
    ...(details?.trim().length ? ["Docker output:", details.trim()] : []),
    "Hint: ensure Docker daemon is running and current user can access /var/run/docker.sock (for example via the docker group).",
    "Hint: if output above contains 'port is already allocated', retry with a free SSH port via --ssh-port <port> (for example --ssh-port 2235), or stop the conflicting project/container.",
    "Hint: if output above contains 'all predefined address pools have been fully subnetted', run `docker network prune -f`, configure Docker `default-address-pools`, or use shared network mode (`--network-mode shared`).",
    ...(isNvidiaRuntimeFailure(details)
      ? [
        "Hint: NVIDIA GPU access is enabled but Docker cannot load the host NVIDIA runtime; run with GPU disabled (`--gpu none`) or install the NVIDIA driver and NVIDIA Container Toolkit."
      ]
      : []),
    ...(isAptInvalidSignatureFailure(details)
      ? [
        "Hint: apt reported invalid signatures for multiple repositories during Docker build; this can be caused by low Docker host disk space. Check `df -h` and reclaim unused Docker cache with `docker builder prune -af` and `docker image prune -af` before retrying."
      ]
      : []),
    "Hint: if output above contains 'lookup auth.docker.io' or 'read udp ... [::1]:53 ... connection refused', fix Docker DNS resolver (set working DNS in host/daemon config) and retry."
  ].join("\n")

const formatDockerIdentityConflictKind = (
  kind: DockerIdentityConflictError["conflicts"][number]["kind"]
): string =>
  ({
    containerName: "container name",
    browserContainerName: "browser container name",
    serviceName: "compose project name",
    volumeName: "volume name",
    browserVolumeName: "browser volume name",
    bootstrapVolumeName: "bootstrap volume name"
  })[kind]

const renderDockerIdentityConflictError = ({ conflicts, projectDir }: DockerIdentityConflictError): string =>
  [
    `Refusing to create ${projectDir}: Docker identities are already owned by other docker-git projects.`,
    ...conflicts.map(
      ({ conflictingProjectDir, kind, name }) =>
        `${formatDockerIdentityConflictKind(kind)} "${name}" already exists in ${conflictingProjectDir}`
    ),
    "Hint: re-run with --force to replace the conflicting docker-git project, or choose unique --container-name/--service-name/--volume-name."
  ].join("\n")

const renderDockerAccessError = ({ details, issue }: DockerAccessError): string =>
  [
    renderDockerAccessHeadline(issue),
    "Hint: ensure Docker daemon is running and current user can access the docker socket.",
    "Hint: if you use rootless Docker, set DOCKER_HOST to your user socket (for example unix:///run/user/$UID/docker.sock).",
    renderDockerAccessActionPlan(issue),
    `Details: ${details}`
  ].join("\n")

const renderPrimaryError = (error: NonParseError): string | null =>
  Match.value(error).pipe(
    Match.when({ _tag: "FileExistsError" }, ({ path }) => `File already exists: ${path} (use --force to overwrite)`),
    Match.when({ _tag: "DockerCommandError" }, renderDockerCommandError),
    Match.when({ _tag: "DockerAccessError" }, renderDockerAccessError),
    Match.when({ _tag: "DockerIdentityConflictError" }, renderDockerIdentityConflictError),
    Match.when({ _tag: "CloneFailedError" }, ({ repoRef, repoUrl, targetDir }) =>
      `Clone failed for ${repoUrl} (${repoRef}) into ${targetDir}`),
    Match.when({ _tag: "AgentFailedError" }, ({ agentMode, targetDir }) =>
      `Agent (${agentMode}) failed in ${targetDir}`),
    Match.when({ _tag: "PortProbeError" }, ({ message, port }) => `SSH port check failed for ${port}: ${message}`),
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
    Match.when({ _tag: "ScrapTargetDirUnsupportedError" }, ({ reason, targetDir }) =>
      [
        `Cannot use scrap with targetDir ${targetDir}.`,
        `Reason: ${reason}`,
        `Hint: scrap currently supports workspaces under the ssh home directory only (for example: ~/repo).`
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
