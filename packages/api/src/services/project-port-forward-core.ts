import { createHash } from "node:crypto"

import type { ProjectPortForward, ProjectPortForwardStatus } from "../api/contracts.js"
import { projectShortKey, renderForwardProxyPath } from "./project-port-proxy-core.js"

export const portForwardKindLabel = "ai.docker-git.kind"
export const portForwardKindValue = "port-forward"
export const portForwardProjectLabel = "ai.docker-git.project-id"
export const portForwardTargetPortLabel = "ai.docker-git.target-port"
export const portForwardHostPortLabel = "ai.docker-git.host-port"
export const portForwardBindHostLabel = "ai.docker-git.bind-host"
export const portForwardPublicHostLabel = "ai.docker-git.public-host"
export const portForwardTargetContainerLabel = "ai.docker-git.target-container"

const dockerNameMaxLength = 63
const defaultHostPortSearchLimit = 200

export type PortForwardRow = {
  readonly id: string
  readonly name: string
  readonly state: string
  readonly createdAt: string
  readonly projectId: string
  readonly targetPort: string
  readonly hostPort: string
  readonly bindHost: string
  readonly publicHost: string
  readonly targetContainerName: string
}

export type PortForwardRequestPorts = {
  readonly targetPort: number
  readonly hostPort: number | undefined
}

type PortValidationResult =
  | { readonly ok: true; readonly port: number }
  | { readonly ok: false; readonly message: string }

type PortRequestValidationResult =
  | { readonly ok: true; readonly ports: PortForwardRequestPorts }
  | { readonly ok: false; readonly message: string }

const sanitizeNameChunk = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")

const shortHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 12)

const normalizeDockerName = (value: string): string => {
  const sanitized = sanitizeNameChunk(value)
  const name = sanitized.length === 0 ? "port" : sanitized
  return name.length <= dockerNameMaxLength ? name : name.slice(0, dockerNameMaxLength)
}

export const buildPortForwardContainerName = (
  projectId: string,
  targetPort: number
): string => normalizeDockerName(`dg-port-${shortHash(projectId)}-${targetPort}`)

export const validatePort = (value: number, label: string): PortValidationResult =>
  Number.isInteger(value) && value > 0 && value <= 65_535
    ? { ok: true, port: value }
    : { ok: false, message: `${label} must be an integer between 1 and 65535.` }

export const normalizePortForwardRequest = (
  targetPort: number,
  hostPort: number | undefined
): PortRequestValidationResult => {
  const target = validatePort(targetPort, "targetPort")
  if (!target.ok) {
    return target
  }
  if (hostPort === undefined) {
    return { ok: true, ports: { targetPort: target.port, hostPort: undefined } }
  }
  const host = validatePort(hostPort, "hostPort")
  return host.ok
    ? { ok: true, ports: { targetPort: target.port, hostPort: host.port } }
    : host
}

export const selectHostPort = (
  preferredPort: number,
  requestedPort: number | undefined,
  usedPorts: ReadonlySet<number>,
  searchLimit = defaultHostPortSearchLimit
): number | null => {
  if (requestedPort !== undefined) {
    return usedPorts.has(requestedPort) ? null : requestedPort
  }
  for (let port = preferredPort; port <= 65_535 && port < preferredPort + searchLimit; port += 1) {
    if (!usedPorts.has(port)) {
      return port
    }
  }
  return null
}

export const publicHostFromEnv = (fallback = "localhost"): string =>
  process.env["DOCKER_GIT_PUBLIC_HOST"]?.trim() || fallback

export const bindHostFromEnv = (): string =>
  process.env["DOCKER_GIT_PUBLIC_BIND_HOST"]?.trim() || "0.0.0.0"

export const projectsRootVolumeFromEnv = (): string =>
  process.env["DOCKER_GIT_PROJECTS_ROOT_VOLUME"]?.trim() || "docker-git-projects"

export const renderForwardUrl = (publicHost: string, hostPort: number): string =>
  `http://${publicHost}:${hostPort}`

export const statusFromDockerState = (state: string): ProjectPortForwardStatus => {
  const normalized = state.trim().toLowerCase()
  if (normalized === "running") {
    return "running"
  }
  if (normalized === "exited" || normalized === "created" || normalized === "dead" || normalized === "removing") {
    return "stopped"
  }
  return "unknown"
}

const parseRowPort = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : 0
}

export const parsePortForwardRows = (output: string): ReadonlyArray<PortForwardRow> =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parts = line.split("\t")
      if (parts.length < 10) {
        return []
      }
      const [id, name, state, createdAt, projectId, targetPort, hostPort, bindHost, publicHost, targetContainerName] = parts
      return id === undefined ||
        name === undefined ||
        state === undefined ||
        createdAt === undefined ||
        projectId === undefined ||
        targetPort === undefined ||
        hostPort === undefined ||
        bindHost === undefined ||
        publicHost === undefined ||
        targetContainerName === undefined
        ? []
        : [{ id, name, state, createdAt, projectId, targetPort, hostPort, bindHost, publicHost, targetContainerName }]
    })

export const rowToProjectPortForward = (row: PortForwardRow): ProjectPortForward => {
  const hostPort = parseRowPort(row.hostPort)
  const publicHost = row.publicHost.trim().length > 0 ? row.publicHost : "localhost"
  return {
    bindHost: row.bindHost,
    containerName: row.name,
    createdAt: row.createdAt.trim().length === 0 ? null : row.createdAt,
    hostPort,
    id: row.id,
    projectId: row.projectId,
    projectKey: projectShortKey(row.projectId),
    proxyPath: renderForwardProxyPath(row.projectId, parseRowPort(row.targetPort)),
    publicHost,
    status: statusFromDockerState(row.state),
    targetContainerName: row.targetContainerName,
    targetPort: parseRowPort(row.targetPort),
    url: renderForwardUrl(publicHost, hostPort)
  }
}

export const rowsToProjectPortForwards = (rows: ReadonlyArray<PortForwardRow>): ReadonlyArray<ProjectPortForward> =>
  rows.map(rowToProjectPortForward)

export const buildForwardSshScript = (
  targetIp: string,
  sshUser: string,
  targetPort: number
): string => [
  "set -euo pipefail",
  "KEY=/tmp/docker-git-dev-ssh-key",
  "cp /docker-git-projects/dev_ssh_key \"$KEY\"",
  "chmod 600 \"$KEY\"",
  "exec ssh -N \\",
  "  -i \"$KEY\" \\",
  "  -o ExitOnForwardFailure=yes \\",
  "  -o ServerAliveInterval=30 \\",
  "  -o ServerAliveCountMax=3 \\",
  "  -o StrictHostKeyChecking=no \\",
  "  -o UserKnownHostsFile=/dev/null \\",
  "  -o LogLevel=ERROR \\",
  `  -L 0.0.0.0:${targetPort}:127.0.0.1:${targetPort} \\`,
  `  -p 22 ${sshUser}@${targetIp}`
].join("\n")
