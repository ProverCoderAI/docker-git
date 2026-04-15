import { createHash } from "node:crypto"

import type { ProjectDatabaseForward, ProjectDatabaseForwardStatus } from "../api/contracts.js"
import { projectShortKey } from "./project-port-proxy-core.js"

export type ProjectDatabaseEngine = "postgres" | "mysql" | "mariadb"

export type StoredDatabaseProfile = {
  readonly createdAt: string
  readonly database: string
  readonly engine: ProjectDatabaseEngine
  readonly host: string
  readonly id: string
  readonly label: string
  readonly password: string
  readonly port: number
  readonly updatedAt: string
  readonly user: string
  readonly connectionString: string
}

export type PublicDatabaseProfile = {
  readonly createdAt: string
  readonly database: string
  readonly engine: ProjectDatabaseEngine
  readonly host: string
  readonly id: string
  readonly label: string
  readonly maskedConnectionString: string
  readonly port: number
  readonly updatedAt: string
  readonly user: string
}

export type DatabaseProfileFile = {
  readonly version: 1
  readonly profiles: ReadonlyArray<StoredDatabaseProfile>
}

export type ParsedDatabaseConnection = {
  readonly database: string
  readonly engine: ProjectDatabaseEngine
  readonly host: string
  readonly password: string
  readonly port: number
  readonly user: string
}

export type DatabaseProfileParseResult =
  | { readonly ok: true; readonly parsed: ParsedDatabaseConnection }
  | { readonly ok: false; readonly message: string }

export type BuildStoredProfileResult =
  | { readonly ok: true; readonly profile: StoredDatabaseProfile }
  | { readonly ok: false; readonly message: string }

export type ProjectDatabaseProxyPath = {
  readonly projectKey: string
  readonly upstreamPath: string
}

export type ProjectDatabaseSessionStatus = "running" | "stopped" | "missing" | "unknown"

export type DatabaseContainerState = {
  readonly configHash: string
  readonly id: string
  readonly running: boolean
  readonly status: ProjectDatabaseSessionStatus
}

export type ProjectDatabaseForwardRow = {
  readonly bindHost: string
  readonly createdAt: string
  readonly hostPort: string
  readonly id: string
  readonly name: string
  readonly profileId: string
  readonly projectId: string
  readonly publicHost: string
  readonly state: string
  readonly targetHost: string
  readonly targetPort: string
}

const proxyPathPattern = /^\/d\/([a-f0-9]{12})(?:\/(.*))?$/u
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"])
const dockerNameMaxLength = 63
const dbGateOwnedPathPrefixes = [
  "/admin",
  "/admin-license",
  "/build/",
  "/bulma.css",
  "/connections",
  "/database-connections",
  "/dimensions.css",
  "/favicon.ico",
  "/forgot-password",
  "/global.css",
  "/icon-colors.css",
  "/license",
  "/login",
  "/manifest.json",
  "/oauth",
  "/plugins",
  "/redirect",
  "/reset-password",
  "/runners",
  "/scheduler",
  "/set-admin-password",
  "/storage",
  "/tokens.css"
]

export const projectDatabaseCookieName = "docker_git_dbgate_project"

const dbGateEnginePlugins: Readonly<Record<ProjectDatabaseEngine, string>> = {
  mariadb: "mysql@dbgate-plugin-mysql",
  mysql: "mysql@dbgate-plugin-mysql",
  postgres: "postgres@dbgate-plugin-postgres"
}

const defaultPorts: Readonly<Record<ProjectDatabaseEngine, number>> = {
  mariadb: 3306,
  mysql: 3306,
  postgres: 5432
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readString = (record: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = record[key]
  return typeof value === "string" ? value : null
}

const readNumber = (record: Readonly<Record<string, unknown>>, key: string): number | null => {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const parseRowPort = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : 0
}

const readEngine = (record: Readonly<Record<string, unknown>>): ProjectDatabaseEngine | null => {
  const value = record["engine"]
  return value === "postgres" || value === "mysql" || value === "mariadb" ? value : null
}

const engineFromProtocol = (protocol: string): ProjectDatabaseEngine | null => {
  if (protocol === "postgres:" || protocol === "postgresql:") {
    return "postgres"
  }
  if (protocol === "mysql:") {
    return "mysql"
  }
  if (protocol === "mariadb:") {
    return "mariadb"
  }
  return null
}

const decodeUrlPart = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const parsePort = (url: URL, engine: ProjectDatabaseEngine): number | null => {
  if (url.port.length === 0) {
    return defaultPorts[engine]
  }
  const port = Number.parseInt(url.port, 10)
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
}

const databaseFromPath = (url: URL): string | null => {
  const value = decodeUrlPart(url.pathname.replace(/^\/+/u, ""))
  return value.length > 0 ? value : null
}

export const parseDatabaseConnectionString = (connectionString: string): DatabaseProfileParseResult => {
  const trimmed = connectionString.trim()
  if (trimmed.length === 0) {
    return { ok: false, message: "CONNECTION_STRING is empty." }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, message: "CONNECTION_STRING is not a valid URL." }
  }

  const engine = engineFromProtocol(url.protocol)
  if (engine === null) {
    return { ok: false, message: "Supported database URLs: postgres://, postgresql://, mysql://, mariadb://." }
  }

  if (url.hostname.length === 0) {
    return { ok: false, message: "CONNECTION_STRING must include a host." }
  }

  const port = parsePort(url, engine)
  if (port === null) {
    return { ok: false, message: "CONNECTION_STRING port must be between 1 and 65535." }
  }

  const database = databaseFromPath(url)
  if (database === null) {
    return { ok: false, message: "CONNECTION_STRING must include a database name." }
  }

  return {
    ok: true,
    parsed: {
      database,
      engine,
      host: url.hostname,
      password: decodeUrlPart(url.password),
      port,
      user: decodeUrlPart(url.username)
    }
  }
}

export const profileIdForConnectionString = (connectionString: string): string =>
  `db_${createHash("sha256").update(connectionString.trim()).digest("hex").slice(0, 16)}`

export const defaultProfileLabel = (parsed: ParsedDatabaseConnection): string =>
  `${parsed.engine} ${parsed.host}:${parsed.port}/${parsed.database}`

export const buildStoredProfile = (
  connectionString: string,
  label: string | null | undefined,
  nowIso: string,
  previous?: StoredDatabaseProfile | undefined
): BuildStoredProfileResult => {
  const parsed = parseDatabaseConnectionString(connectionString)
  if (!parsed.ok) {
    return { ok: false, message: parsed.message }
  }
  const trimmedLabel = (label ?? "").trim()
  return {
    ok: true,
    profile: {
      ...parsed.parsed,
      connectionString: connectionString.trim(),
      createdAt: previous?.createdAt ?? nowIso,
      id: profileIdForConnectionString(connectionString),
      label: trimmedLabel.length === 0 ? previous?.label ?? defaultProfileLabel(parsed.parsed) : trimmedLabel,
      updatedAt: nowIso
    }
  }
}

export const maskConnectionString = (connectionString: string): string => {
  try {
    const url = new URL(connectionString)
    if (url.password.length > 0) {
      url.password = "********"
    }
    return url.toString()
  } catch {
    return connectionString.replace(/(:\/\/[^:\s/@]+:)([^@\s]+)(@)/u, "$1********$3")
  }
}

export const externalDatabaseConnectionString = (
  profile: StoredDatabaseProfile,
  publicHost: string,
  hostPort: number
): string => {
  try {
    const url = new URL(profile.connectionString)
    url.hostname = publicHost
    url.port = String(hostPort)
    return url.toString()
  } catch {
    return profile.connectionString
  }
}

export const toPublicDatabaseProfile = (profile: StoredDatabaseProfile): PublicDatabaseProfile => ({
  createdAt: profile.createdAt,
  database: profile.database,
  engine: profile.engine,
  host: profile.host,
  id: profile.id,
  label: profile.label,
  maskedConnectionString: maskConnectionString(profile.connectionString),
  port: profile.port,
  updatedAt: profile.updatedAt,
  user: profile.user
})

export const toPublicDatabaseProfiles = (
  profiles: ReadonlyArray<StoredDatabaseProfile>
): ReadonlyArray<PublicDatabaseProfile> =>
  profiles.map(toPublicDatabaseProfile)

export const emptyDatabaseProfileFile = (): DatabaseProfileFile => ({ profiles: [], version: 1 })

const decodeStoredProfile = (value: unknown): StoredDatabaseProfile | null => {
  if (!isRecord(value)) {
    return null
  }
  const engine = readEngine(value)
  const createdAt = readString(value, "createdAt")
  const database = readString(value, "database")
  const host = readString(value, "host")
  const id = readString(value, "id")
  const label = readString(value, "label")
  const password = readString(value, "password")
  const port = readNumber(value, "port")
  const updatedAt = readString(value, "updatedAt")
  const user = readString(value, "user")
  const connectionString = readString(value, "connectionString")
  if (
    engine === null ||
    createdAt === null ||
    database === null ||
    host === null ||
    id === null ||
    label === null ||
    password === null ||
    port === null ||
    updatedAt === null ||
    user === null ||
    connectionString === null
  ) {
    return null
  }
  return { connectionString, createdAt, database, engine, host, id, label, password, port, updatedAt, user }
}

export const decodeDatabaseProfileFile = (text: string): DatabaseProfileFile => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return emptyDatabaseProfileFile()
  }
  if (!isRecord(parsed) || parsed["version"] !== 1 || !Array.isArray(parsed["profiles"])) {
    return emptyDatabaseProfileFile()
  }
  return {
    profiles: parsed["profiles"].flatMap((item) => {
      const profile = decodeStoredProfile(item)
      return profile === null ? [] : [profile]
    }),
    version: 1
  }
}

export const encodeDatabaseProfileFile = (file: DatabaseProfileFile): string =>
  `${JSON.stringify(file, null, 2)}\n`

export const upsertDatabaseProfile = (
  profiles: ReadonlyArray<StoredDatabaseProfile>,
  profile: StoredDatabaseProfile
): ReadonlyArray<StoredDatabaseProfile> => [
  profile,
  ...profiles.filter((item) => item.id !== profile.id)
]

export const deleteDatabaseProfile = (
  profiles: ReadonlyArray<StoredDatabaseProfile>,
  profileId: string
): ReadonlyArray<StoredDatabaseProfile> =>
  profiles.filter((item) => item.id !== profileId)

export const databasesConfigHash = (profiles: ReadonlyArray<StoredDatabaseProfile>): string =>
  createHash("sha256")
    .update(JSON.stringify(profiles.map((profile) => ({
      connectionString: profile.connectionString,
      id: profile.id,
      label: profile.label
    }))))
    .digest("hex")
    .slice(0, 16)

export const renderProjectDatabaseProxyPath = (projectId: string): string =>
  `/d/${projectShortKey(projectId)}/`

export const parseProjectDatabaseProxyPath = (pathname: string): ProjectDatabaseProxyPath | null => {
  const match = proxyPathPattern.exec(pathname)
  if (match === null) {
    return null
  }
  const [, projectKey, rawPath] = match
  return projectKey === undefined
    ? null
    : {
      projectKey,
      upstreamPath: `/${rawPath ?? ""}`
    }
}

export const isDbGateOwnedPath = (pathname: string): boolean =>
  dbGateOwnedPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix))

export const readProjectDatabaseCookie = (cookieHeader: string | undefined): string | null => {
  if (cookieHeader === undefined) {
    return null
  }
  for (const entry of cookieHeader.split(";")) {
    const [rawName, rawValue = ""] = entry.trim().split("=")
    if (rawName === projectDatabaseCookieName && /^[a-f0-9]{12}$/u.test(rawValue)) {
      return rawValue
    }
  }
  return null
}

export const parseProjectDatabaseReferer = (refererHeader: string | undefined): string | null => {
  if (refererHeader === undefined) {
    return null
  }
  try {
    const target = parseProjectDatabaseProxyPath(new URL(refererHeader).pathname)
    return target?.projectKey ?? null
  } catch {
    return null
  }
}

export const parseProjectDatabaseStatefulProxyPath = (
  pathname: string,
  refererHeader: string | undefined,
  cookieHeader: string | undefined
): ProjectDatabaseProxyPath | null => {
  if (!isDbGateOwnedPath(pathname)) {
    return null
  }
  const projectKey = parseProjectDatabaseReferer(refererHeader) ?? readProjectDatabaseCookie(cookieHeader)
  return projectKey === null
    ? null
    : {
      projectKey,
      upstreamPath: pathname
    }
}

export const isLoopbackDatabaseHost = (host: string): boolean =>
  loopbackHosts.has(host.trim().toLowerCase())

export const dbGateConnectionId = (profile: StoredDatabaseProfile): string =>
  profile.id.toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_")

export const dbGateEngine = (engine: ProjectDatabaseEngine): string =>
  dbGateEnginePlugins[engine]

export const dbGateServerForProfile = (
  profile: StoredDatabaseProfile,
  projectLoopbackHost: string
): string =>
  isLoopbackDatabaseHost(profile.host) ? projectLoopbackHost : profile.host

export const projectDatabaseKindLabel = "ai.docker-git.kind"
export const projectDatabaseKindValue = "dbgate"
export const projectDatabaseForwardKindValue = "db-forward"
export const projectDatabaseProjectLabel = "ai.docker-git.project-id"
export const projectDatabaseConfigHashLabel = "ai.docker-git.dbgate.config-hash"
export const projectDatabaseForwardBindHostLabel = "ai.docker-git.db-forward.bind-host"
export const projectDatabaseForwardHostPortLabel = "ai.docker-git.db-forward.host-port"
export const projectDatabaseForwardProfileLabel = "ai.docker-git.db-forward.profile-id"
export const projectDatabaseForwardPublicHostLabel = "ai.docker-git.db-forward.public-host"
export const projectDatabaseForwardTargetHostLabel = "ai.docker-git.db-forward.target-host"
export const projectDatabaseForwardTargetPortLabel = "ai.docker-git.db-forward.target-port"

export const buildProjectDatabaseContainerName = (projectContainerName: string): string =>
  `${projectContainerName}-dbgate`.slice(0, 63)

export const buildProjectDatabaseVolumeName = (projectId: string): string =>
  `dg-dbgate-${projectShortKey(projectId)}`

export const buildProjectDatabaseForwardContainerName = (
  projectId: string,
  profileId: string
): string =>
  `dg-db-${projectShortKey(projectId)}-${profileId.replace(/[^a-zA-Z0-9_.-]+/g, "-")}`.slice(0, dockerNameMaxLength)

export const databaseForwardTargetHost = (
  profile: StoredDatabaseProfile,
  projectLoopbackHost: string
): string =>
  isLoopbackDatabaseHost(profile.host) ? projectLoopbackHost : profile.host

export const databaseStatusFromDockerState = (
  running: boolean,
  state: string
): ProjectDatabaseSessionStatus => {
  const normalized = state.trim().toLowerCase()
  if (running) {
    return "running"
  }
  if (normalized === "missing") {
    return "missing"
  }
  if (normalized === "created" || normalized === "dead" || normalized === "exited" || normalized === "removing") {
    return "stopped"
  }
  return "unknown"
}

export const databaseForwardStatusFromDockerState = (state: string): ProjectDatabaseForwardStatus => {
  const normalized = state.trim().toLowerCase()
  if (normalized === "running") {
    return "running"
  }
  if (normalized === "created" || normalized === "dead" || normalized === "exited" || normalized === "removing") {
    return "stopped"
  }
  return "unknown"
}

export const parseProjectDatabaseForwardRows = (output: string): ReadonlyArray<ProjectDatabaseForwardRow> =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parts = line.split("\t")
      if (parts.length < 11) {
        return []
      }
      const [
        id,
        name,
        state,
        createdAt,
        projectId,
        profileId,
        targetHost,
        targetPort,
        hostPort,
        bindHost,
        publicHost
      ] = parts
      return id === undefined ||
        name === undefined ||
        state === undefined ||
        createdAt === undefined ||
        projectId === undefined ||
        profileId === undefined ||
        targetHost === undefined ||
        targetPort === undefined ||
        hostPort === undefined ||
        bindHost === undefined ||
        publicHost === undefined
        ? []
        : [{
          bindHost,
          createdAt,
          hostPort,
          id,
          name,
          profileId,
          projectId,
          publicHost,
          state,
          targetHost,
          targetPort
        }]
    })

export const rowToProjectDatabaseForward = (
  row: ProjectDatabaseForwardRow,
  profile: StoredDatabaseProfile
): ProjectDatabaseForward => {
  const hostPort = parseRowPort(row.hostPort)
  const targetPort = parseRowPort(row.targetPort)
  const publicHost = row.publicHost.trim().length > 0 ? row.publicHost : "localhost"
  const externalConnectionString = externalDatabaseConnectionString(profile, publicHost, hostPort)
  return {
    bindHost: row.bindHost,
    containerName: row.name,
    createdAt: row.createdAt.trim().length === 0 ? null : row.createdAt,
    database: profile.database,
    engine: profile.engine,
    externalConnectionString,
    hostPort,
    id: row.id,
    maskedExternalConnectionString: maskConnectionString(externalConnectionString),
    profileId: profile.id,
    profileLabel: profile.label,
    projectId: row.projectId,
    projectKey: projectShortKey(row.projectId),
    publicHost,
    status: databaseForwardStatusFromDockerState(row.state),
    targetHost: row.targetHost,
    targetPort
  }
}

export const rowsToProjectDatabaseForwards = (
  rows: ReadonlyArray<ProjectDatabaseForwardRow>,
  profiles: ReadonlyArray<StoredDatabaseProfile>
): ReadonlyArray<ProjectDatabaseForward> =>
  rows.flatMap((row) => {
    const profile = profiles.find((item) => item.id === row.profileId)
    return profile === undefined ? [] : [rowToProjectDatabaseForward(row, profile)]
  })
