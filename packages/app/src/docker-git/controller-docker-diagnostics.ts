import { Match } from "effect"

// PURITY: CORE
// EFFECT: pure functions; no IO, no process, no time
// INVARIANT: classification depends only on the supplied probe output and exit code

export type DockerProbeFailureKind =
  | "docker-cli-missing"
  | "socket-permission-denied"
  | "daemon-unreachable"
  | "unknown"

export type DockerProbeOutcome = {
  readonly exitCode: number
  readonly stderr: string
}

const lowercase = (text: string): string => text.toLowerCase()

const containsAny = (haystack: string, needles: ReadonlyArray<string>): boolean =>
  needles.some((needle) => haystack.includes(needle))

const isCliMissingExitCode = (exitCode: number): boolean => exitCode === 127

const cliMissingMarkers: ReadonlyArray<string> = [
  "command not found",
  "not found",
  "no such file or directory"
]

const permissionMarkers: ReadonlyArray<string> = [
  "permission denied",
  "access is denied",
  "got permission denied"
]

const daemonDownMarkers: ReadonlyArray<string> = [
  "cannot connect to the docker daemon",
  "is the docker daemon running",
  "no such file or directory",
  "connection refused"
]

export const classifyDockerProbeFailure = (outcome: DockerProbeOutcome): DockerProbeFailureKind => {
  const normalized = lowercase(outcome.stderr)

  if (containsAny(normalized, permissionMarkers)) {
    return "socket-permission-denied"
  }

  if (isCliMissingExitCode(outcome.exitCode) && containsAny(normalized, cliMissingMarkers)) {
    return "docker-cli-missing"
  }

  if (containsAny(normalized, daemonDownMarkers)) {
    return "daemon-unreachable"
  }

  return "unknown"
}

export type DockerAccessDeniedContext = {
  readonly directProbe: DockerProbeOutcome
  readonly sudoProbe: DockerProbeOutcome | null
  readonly apiBaseUrl: string
  readonly dockerHost: string | null
}

const firstNonEmptyLine = (text: string): string => {
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return ""
}

const renderProbeLine = (label: string, probe: DockerProbeOutcome | null): string => {
  if (probe === null) {
    return `${label}: skipped`
  }
  const stderrSummary = firstNonEmptyLine(probe.stderr)
  const summaryText = stderrSummary.length > 0 ? stderrSummary : "no stderr"
  return `${label}: exit=${probe.exitCode}; ${summaryText}`
}

const renderHeadlineForKind = (kind: DockerProbeFailureKind): string =>
  Match.value(kind).pipe(
    Match.when(
      "socket-permission-denied",
      () => "Host Docker socket rejected this user (socket permission mismatch, not a docker-git outage)."
    ),
    Match.when(
      "daemon-unreachable",
      () => "Host Docker daemon is not reachable from this user (daemon down or wrong DOCKER_HOST)."
    ),
    Match.when("docker-cli-missing", () => "docker CLI was not found on this machine."),
    Match.when("unknown", () => "docker-git host CLI cannot access Docker from the client process."),
    Match.exhaustive
  )

const renderRemediationForKind = (kind: DockerProbeFailureKind, apiBaseUrl: string): ReadonlyArray<string> => {
  const apiHint =
    `Or keep the docker-git backend container running and reach it via DOCKER_GIT_API_URL (default ${apiBaseUrl}).`
  return Match.value(kind).pipe(
    Match.when("socket-permission-denied", (): ReadonlyArray<string> => [
      "docker-git is intentionally backed by the host Docker daemon via /var/run/docker.sock.",
      "Add this user to the docker group, switch to rootless Docker, or fix /var/run/docker.sock ownership (root:docker, mode 660).",
      "After changing groups, log out and back in (or run `newgrp docker`) so the new group membership applies.",
      apiHint
    ]),
    Match.when("daemon-unreachable", (): ReadonlyArray<string> => [
      "Start the Docker daemon (e.g. `sudo systemctl start docker`) or set DOCKER_HOST to a reachable endpoint.",
      apiHint
    ]),
    Match.when("docker-cli-missing", (): ReadonlyArray<string> => [
      "Install Docker Engine or Docker Desktop and ensure `docker` is on PATH.",
      apiHint
    ]),
    Match.when("unknown", (): ReadonlyArray<string> => [
      "Tried direct Docker and passwordless sudo Docker; both probes failed.",
      "Grant this user direct Docker access (docker group/rootless Docker), configure passwordless sudo for docker, or",
      apiHint
    ]),
    Match.exhaustive
  )
}

// PURITY: CORE
// EFFECT: pure function over diagnostic context
// INVARIANT: emitted message names the failure mode, the contract, and the next action
export const renderDockerAccessDeniedMessage = (context: DockerAccessDeniedContext): string => {
  const directKind = classifyDockerProbeFailure(context.directProbe)
  const dockerHostLine = context.dockerHost !== null && context.dockerHost.length > 0
    ? `DOCKER_HOST: ${context.dockerHost}`
    : "DOCKER_HOST: unset (defaults to unix:///var/run/docker.sock)"

  return [
    renderHeadlineForKind(directKind),
    "Runtime contract: docker-git is host-Docker-backed; the controller container talks to the daemon via /var/run/docker.sock.",
    ...renderRemediationForKind(directKind, context.apiBaseUrl),
    "Probe commands: docker info; sudo -n docker info",
    renderProbeLine("Direct probe", context.directProbe),
    renderProbeLine("Sudo probe", context.sudoProbe),
    dockerHostLine
  ].join("\n")
}
