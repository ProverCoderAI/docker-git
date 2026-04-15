import * as FileSystem from "@effect/platform/FileSystem"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as HttpHeaders from "@effect/platform/Headers"
import * as HttpServerError from "@effect/platform/HttpServerError"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import type { ListProjectsContext } from "@effect-template/lib/usecases/projects-list"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { runDockerPsPublishedHostPorts } from "@effect-template/lib/shell/docker"
import { parseInspectNetworkEntry } from "@effect-template/lib/shell/docker-inspect-parse"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { loadProjectIndex, loadProjectStatus } from "@effect-template/lib/usecases/projects-core"
import { Duration, Effect, Schedule } from "effect"
import * as Stream from "effect/Stream"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import { dirname } from "node:path"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer, type RawData } from "ws"

import type {
  ProjectDatabaseForward,
  ProjectDatabaseProfile,
  ProjectDatabaseProfileRequest,
  ProjectDatabaseSession
} from "../api/contracts.js"
import { ApiBadRequestError, ApiConflictError, ApiInternalError, ApiNotFoundError } from "../api/errors.js"
import { getProjectItemById } from "./projects.js"
import {
  buildProjectDatabaseContainerName,
  buildProjectDatabaseForwardContainerName,
  buildProjectDatabaseVolumeName,
  buildStoredProfile,
  databaseForwardTargetHost,
  databaseStatusFromDockerState,
  databasesConfigHash,
  dbGateConnectionId,
  dbGateEngine,
  dbGateServerForProfile,
  decodeDatabaseProfileFile,
  deleteDatabaseProfile,
  encodeDatabaseProfileFile,
  emptyDatabaseProfileFile,
  parseProjectDatabaseProxyPath,
  parseProjectDatabaseForwardRows,
  projectDatabaseConfigHashLabel,
  projectDatabaseCookieName,
  projectDatabaseForwardBindHostLabel,
  projectDatabaseForwardHostPortLabel,
  projectDatabaseForwardKindValue,
  projectDatabaseForwardProfileLabel,
  projectDatabaseForwardPublicHostLabel,
  projectDatabaseForwardTargetHostLabel,
  projectDatabaseForwardTargetPortLabel,
  projectDatabaseKindLabel,
  projectDatabaseKindValue,
  projectDatabaseProjectLabel,
  renderProjectDatabaseProxyPath,
  rowsToProjectDatabaseForwards,
  toPublicDatabaseProfiles,
  upsertDatabaseProfile,
  type DatabaseContainerState,
  type ProjectDatabaseForwardRow,
  type ProjectDatabaseProxyPath,
  type StoredDatabaseProfile
} from "./project-databases-core.js"
import { bindHostFromEnv, publicHostFromEnv, selectHostPort } from "./project-port-forward-core.js"
import { normalizeForwardedPrefix, projectShortKey, rewriteProxyLocation } from "./project-port-proxy-core.js"

type DatabaseApiError =
  | ApiBadRequestError
  | ApiConflictError
  | ApiInternalError
  | ApiNotFoundError

type DatabaseRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type ContainerNetworkEntry = {
  readonly ipAddress: string
  readonly name: string
}

type DatabaseProjectLookup = {
  readonly containerName: string
  readonly projectDir: string
  readonly projectId: string
}

type DatabaseProjectRuntime = {
  readonly containerName: string
  readonly projectDir: string
}

type DatabaseProfileProject = {
  readonly projectDir: string
}

type DatabaseProxyUpstream = {
  readonly projectId: string
  readonly projectKey: string
  readonly proxyPath: string
  readonly upstreamOrigin: string
  readonly upstreamUrl: URL
}

type DatabaseForwardTarget = {
  readonly projectNetworks: ReadonlyArray<ContainerNetworkEntry>
  readonly selectedNetwork: ContainerNetworkEntry
  readonly targetHost: string
}

const dockerOkExit = [0]
const dbGatePort = 3000
const profileFileRelPath = [".orch", "databases", "profiles.json"]
const databaseProxyRetrySchedule = Schedule.addDelay(
  Schedule.recurs(60),
  () => Duration.millis(500)
)

const hopByHopRequestHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
])

const hopByHopResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
])

const dockerGitApiContainerName = (): string => process.env["DOCKER_GIT_API_CONTAINER_NAME"]?.trim() || "docker-git-api"

const dbGateImage = (): string => process.env["DOCKER_GIT_DBGATE_IMAGE"]?.trim() || "dbgate/dbgate:alpine"

const databaseTcpProxyImage = (): string =>
  process.env["DOCKER_GIT_DB_TCP_PROXY_IMAGE"]?.trim() || "alpine/socat:latest"

const dockerCapture = (
  cwd: string,
  args: ReadonlyArray<string>,
  command: string,
  okExitCodes: ReadonlyArray<number> = dockerOkExit
) =>
  runCommandCapture(
    { args, command: "docker", cwd },
    okExitCodes,
    (exitCode) => new CommandFailedError({ command, exitCode })
  )

const toInternalDockerError = (
  message: string,
  cause: unknown
): ApiInternalError =>
  new ApiInternalError({ message, cause })

const databaseProfilePath = (path: Path.Path, projectDir: string): string =>
  path.join(projectDir, ...profileFileRelPath)

const readStoredProfiles = (
  project: DatabaseProfileProject
): Effect.Effect<ReadonlyArray<StoredDatabaseProfile>, DatabaseApiError | PlatformError, DatabaseRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const filePath = databaseProfilePath(path, project.projectDir)
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return emptyDatabaseProfileFile().profiles
    }
    const text = yield* _(fs.readFileString(filePath))
    return decodeDatabaseProfileFile(text).profiles
  }).pipe(
    Effect.mapError((error) =>
      error instanceof ApiBadRequestError ||
        error instanceof ApiConflictError ||
        error instanceof ApiInternalError ||
        error instanceof ApiNotFoundError
        ? error
        : new ApiInternalError({ message: "Failed to read database profiles.", cause: error })
    )
  )

const writeStoredProfiles = (
  project: ProjectItem,
  profiles: ReadonlyArray<StoredDatabaseProfile>
): Effect.Effect<void, DatabaseApiError | PlatformError, DatabaseRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const filePath = databaseProfilePath(path, project.projectDir)
    yield* _(fs.makeDirectory(path.dirname(filePath), { recursive: true }))
    yield* _(fs.writeFileString(filePath, encodeDatabaseProfileFile({ profiles, version: 1 })))
    yield* _(fs.chmod(filePath, 0o600).pipe(Effect.orElseSucceed(() => void 0)))
    yield* _(autoSyncState(`chore(state): db profiles ${project.displayName}`))
  }).pipe(
    Effect.mapError((error) =>
      error instanceof ApiBadRequestError ||
        error instanceof ApiConflictError ||
        error instanceof ApiInternalError ||
        error instanceof ApiNotFoundError
        ? error
        : new ApiInternalError({ message: "Failed to write database profiles.", cause: error })
    )
  )

export const listProjectDatabaseProfiles = (
  projectId: string
): Effect.Effect<ReadonlyArray<ProjectDatabaseProfile>, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const profiles = yield* _(readStoredProfiles(project))
    return toPublicDatabaseProfiles(profiles)
  })

export const saveProjectDatabaseProfile = (
  projectId: string,
  request: ProjectDatabaseProfileRequest
): Effect.Effect<ProjectDatabaseProfile, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const profiles = yield* _(readStoredProfiles(project))
    const nowIso = new Date().toISOString()
    const nextId = buildStoredProfile(request.connectionString, request.label, nowIso)
    if (!nextId.ok) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: nextId.message })))
    }
    const previous = profiles.find((profile) => profile.id === nextId.profile.id)
    const rebuilt = buildStoredProfile(request.connectionString, request.label, nowIso, previous)
    if (!rebuilt.ok) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: rebuilt.message })))
    }
    const nextProfiles = upsertDatabaseProfile(profiles, rebuilt.profile)
    yield* _(writeStoredProfiles(project, nextProfiles))
    return toPublicDatabaseProfiles([rebuilt.profile])[0]!
  })

export const deleteProjectDatabaseProfile = (
  projectId: string,
  profileId: string
): Effect.Effect<void, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const profiles = yield* _(readStoredProfiles(project))
    const nextProfiles = deleteDatabaseProfile(profiles, profileId)
    if (nextProfiles.length === profiles.length) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Database profile not found: ${profileId}` })))
    }
    yield* _(removeDatabaseForwardByProfileId(project, profileId).pipe(Effect.orElseSucceed(() => void 0)))
    yield* _(writeStoredProfiles(project, nextProfiles))
  })

const listDatabaseForwardRows = (
  projectId: string
): Effect.Effect<ReadonlyArray<ProjectDatabaseForwardRow>, DatabaseApiError, CommandExecutor.CommandExecutor> =>
  dockerCapture(
    process.cwd(),
    [
      "ps",
      "-a",
      "--filter",
      `label=${projectDatabaseKindLabel}=${projectDatabaseForwardKindValue}`,
      "--filter",
      `label=${projectDatabaseProjectLabel}=${projectId}`,
      "--format",
      [
        "{{.ID}}",
        "{{.Names}}",
        "{{.State}}",
        "{{.CreatedAt}}",
        `{{.Label "${projectDatabaseProjectLabel}"}}`,
        `{{.Label "${projectDatabaseForwardProfileLabel}"}}`,
        `{{.Label "${projectDatabaseForwardTargetHostLabel}"}}`,
        `{{.Label "${projectDatabaseForwardTargetPortLabel}"}}`,
        `{{.Label "${projectDatabaseForwardHostPortLabel}"}}`,
        `{{.Label "${projectDatabaseForwardBindHostLabel}"}}`,
        `{{.Label "${projectDatabaseForwardPublicHostLabel}"}}`
      ].join("\\t")
    ],
    "docker ps database forwards"
  ).pipe(
    Effect.map(parseProjectDatabaseForwardRows),
    Effect.mapError((error) => toInternalDockerError("Failed to list database TCP forwards.", error))
  )

export const listProjectDatabaseForwards = (
  projectId: string
): Effect.Effect<ReadonlyArray<ProjectDatabaseForward>, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const profiles = yield* _(readStoredProfiles(project))
    const rows = yield* _(listDatabaseForwardRows(project.projectDir))
    return rowsToProjectDatabaseForwards(rows, profiles)
  })

const removeDatabaseForwardContainer = (
  project: DatabaseProjectRuntime,
  containerName: string
) =>
  dockerCapture(
    project.projectDir,
    ["rm", "-f", containerName],
    "docker rm -f database forward",
    [0, 1]
  ).pipe(
    Effect.asVoid,
    Effect.mapError((error) => toInternalDockerError(`Failed to remove database forward ${containerName}.`, error))
  )

const removeDatabaseForwardByProfileId = (
  project: DatabaseProjectRuntime,
  profileId: string
) =>
  listDatabaseForwardRows(project.projectDir).pipe(
    Effect.flatMap((rows) => {
      const row = rows.find((item) => item.profileId === profileId)
      return row === undefined ? Effect.void : removeDatabaseForwardContainer(project, row.name)
    })
  )

const parseContainerNetworkEntries = (output: string): ReadonlyArray<ContainerNetworkEntry> =>
  output
    .trim()
    .split(/\r?\n/u)
    .flatMap((line) => parseInspectNetworkEntry(line))
    .map(([name, ipAddress]) => ({ ipAddress, name }))

const inspectContainerNetworks = (
  cwd: string,
  containerName: string
) =>
  dockerCapture(
    cwd,
    [
      "inspect",
      "-f",
      String.raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`,
      containerName
    ],
    "docker inspect networks"
  ).pipe(
    Effect.map(parseContainerNetworkEntries),
    Effect.mapError((error) => toInternalDockerError(`Failed to inspect container networks: ${containerName}`, error))
  )

const connectContainerToNetwork = (
  cwd: string,
  networkName: string,
  containerName: string
) =>
  networkName === "bridge"
    ? Effect.void
    : dockerCapture(
      cwd,
      ["network", "connect", networkName, containerName],
      `docker network connect ${networkName}`
    ).pipe(
      Effect.asVoid,
      Effect.orElseSucceed(() => void 0)
    )

const selectReachableNetwork = (
  entries: ReadonlyArray<ContainerNetworkEntry>
): ContainerNetworkEntry | null =>
  entries.find((entry) => entry.name !== "bridge") ?? entries[0] ?? null

const inspectDatabaseContainerState = (
  cwd: string,
  containerName: string
): Effect.Effect<DatabaseContainerState, never, CommandExecutor.CommandExecutor> =>
  dockerCapture(
    cwd,
    [
      "inspect",
      "-f",
      `{{.Id}}\t{{.State.Running}}\t{{.State.Status}}\t{{index .Config.Labels "${projectDatabaseConfigHashLabel}"}}`,
      containerName
    ],
    "docker inspect dbgate"
  ).pipe(
    Effect.map((output) => {
      const [id = "", rawRunning = "", rawState = "", configHash = ""] = output.trim().split("\t")
      const running = rawRunning === "true"
      return {
        configHash,
        id,
        running,
        status: databaseStatusFromDockerState(running, rawState)
      }
    }),
    Effect.catchAll(() =>
      Effect.succeed({
        configHash: "",
        id: "",
        running: false,
        status: "missing" as DatabaseContainerState["status"]
      })
    )
  )

const ensureDatabaseReachableIp = (
  cwd: string,
  containerName: string
): Effect.Effect<string, DatabaseApiError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const entries = yield* _(inspectContainerNetworks(cwd, containerName))
    yield* _(
      Effect.forEach(
        entries.filter((entry) => entry.name !== "bridge"),
        (entry) => connectContainerToNetwork(cwd, entry.name, dockerGitApiContainerName()),
        { discard: true }
      )
    )
    const selected = selectReachableNetwork(entries)
    if (selected === null || selected.ipAddress.length === 0) {
      return yield* _(Effect.fail(new ApiInternalError({ message: `DbGate container has no reachable IP: ${containerName}` })))
    }
    return selected.ipAddress
  })

const chooseDatabaseForwardHostPort = (
  project: ProjectItem,
  targetPort: number
) =>
  runDockerPsPublishedHostPorts(project.projectDir).pipe(
    Effect.map((usedPorts) => selectHostPort(targetPort, undefined, new Set(usedPorts))),
    Effect.flatMap((hostPort) =>
      hostPort === null
        ? Effect.fail(new ApiConflictError({ message: `Host port ${targetPort} is not available.` }))
        : Effect.succeed(hostPort)
    ),
    Effect.mapError((error) =>
      error instanceof ApiConflictError
        ? error
        : toInternalDockerError("Failed to inspect published Docker ports.", error)
    )
  )

const resolveDatabaseForwardTarget = (
  project: DatabaseProjectRuntime,
  profile: StoredDatabaseProfile
): Effect.Effect<DatabaseForwardTarget, DatabaseApiError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const projectNetworks = yield* _(inspectContainerNetworks(project.projectDir, project.containerName))
    const selectedNetwork = selectReachableNetwork(projectNetworks)
    if (selectedNetwork === null || selectedNetwork.ipAddress.length === 0) {
      return yield* _(Effect.fail(new ApiInternalError({ message: `Project container has no reachable network: ${project.containerName}` })))
    }
    return {
      projectNetworks,
      selectedNetwork,
      targetHost: databaseForwardTargetHost(profile, selectedNetwork.ipAddress)
    }
  })

const runDatabaseForwardContainer = (
  project: ProjectItem,
  profile: StoredDatabaseProfile,
  target: DatabaseForwardTarget,
  hostPort: number,
  publicHostFallback: string | undefined
) =>
  Effect.gen(function*(_) {
    const bindHost = bindHostFromEnv()
    const publicHost = publicHostFromEnv(publicHostFallback)
    const containerName = buildProjectDatabaseForwardContainerName(project.projectDir, profile.id)
    yield* _(
      dockerCapture(
        project.projectDir,
        [
          "run",
          "-d",
          "--name",
          containerName,
          "--label",
          `${projectDatabaseKindLabel}=${projectDatabaseForwardKindValue}`,
          "--label",
          `${projectDatabaseProjectLabel}=${project.projectDir}`,
          "--label",
          `${projectDatabaseForwardProfileLabel}=${profile.id}`,
          "--label",
          `${projectDatabaseForwardTargetHostLabel}=${target.targetHost}`,
          "--label",
          `${projectDatabaseForwardTargetPortLabel}=${profile.port}`,
          "--label",
          `${projectDatabaseForwardHostPortLabel}=${hostPort}`,
          "--label",
          `${projectDatabaseForwardBindHostLabel}=${bindHost}`,
          "--label",
          `${projectDatabaseForwardPublicHostLabel}=${publicHost}`,
          "--network",
          target.selectedNetwork.name,
          "--publish",
          `${bindHost}:${hostPort}:${profile.port}`,
          databaseTcpProxyImage(),
          `TCP-LISTEN:${profile.port},fork,reuseaddr,bind=0.0.0.0`,
          `TCP:${target.targetHost}:${profile.port}`
        ],
        "docker run database forward"
      ).pipe(
        Effect.asVoid,
        Effect.mapError((error) => toInternalDockerError("Failed to start database TCP forward.", error))
      )
    )
    yield* _(
      Effect.forEach(
        target.projectNetworks.filter((entry) => entry.name !== target.selectedNetwork.name),
        (entry) => connectContainerToNetwork(project.projectDir, entry.name, containerName),
        { discard: true }
      )
    )
  })

export const exposeProjectDatabaseProfile = (
  projectId: string,
  profileId: string,
  publicHostFallback?: string
): Effect.Effect<ProjectDatabaseForward, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const profiles = yield* _(readStoredProfiles(project))
    const profile = profiles.find((item) => item.id === profileId)
    if (profile === undefined) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Database profile not found: ${profileId}` })))
    }
    const currentForwards = yield* _(listProjectDatabaseForwards(projectId))
    const existingForward = currentForwards.find((forward) => forward.profileId === profile.id)
    if (existingForward?.status === "running") {
      return existingForward
    }
    yield* _(removeDatabaseForwardByProfileId(project, profile.id))
    const target = yield* _(resolveDatabaseForwardTarget(project, profile))
    const hostPort = yield* _(chooseDatabaseForwardHostPort(project, profile.port))
    yield* _(runDatabaseForwardContainer(project, profile, target, hostPort, publicHostFallback))
    const nextForwards = yield* _(listProjectDatabaseForwards(projectId))
    const created = nextForwards.find((forward) => forward.profileId === profile.id)
    return yield* _(
      created === undefined
        ? Effect.fail(new ApiInternalError({ message: "Database TCP forward container started but was not found." }))
        : Effect.succeed(created)
    )
  })

export const deleteProjectDatabaseForward = (
  projectId: string,
  profileId: string
): Effect.Effect<void, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const rows = yield* _(listDatabaseForwardRows(project.projectDir))
    const row = rows.find((item) => item.profileId === profileId)
    if (row === undefined) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Database TCP forward not found: ${profileId}` })))
    }
    yield* _(removeDatabaseForwardContainer(project, row.name))
  })

const removeDatabaseContainer = (
  project: DatabaseProjectRuntime,
  containerName: string
) =>
  dockerCapture(
    project.projectDir,
    ["rm", "-f", containerName],
    "docker rm -f dbgate",
    [0, 1]
  ).pipe(
    Effect.asVoid,
    Effect.mapError((error) => toInternalDockerError(`Failed to remove DbGate container ${containerName}.`, error))
  )

const dbGateEnvArgs = (
  profiles: ReadonlyArray<StoredDatabaseProfile>,
  projectLoopbackHost: string
): ReadonlyArray<string> => {
  const connectionIds = profiles.map(dbGateConnectionId)
  const connectionEnv = ["-e", `CONNECTIONS=${connectionIds.join(",")}`]
  const profileEnv = profiles.flatMap((profile) => {
    const id = dbGateConnectionId(profile)
    return [
      "-e",
      `LABEL_${id}=${profile.label}`,
      "-e",
      `SERVER_${id}=${dbGateServerForProfile(profile, projectLoopbackHost)}`,
      "-e",
      `USER_${id}=${profile.user}`,
      "-e",
      `PASSWORD_${id}=${profile.password}`,
      "-e",
      `PORT_${id}=${profile.port}`,
      "-e",
      `DATABASE_${id}=${profile.database}`,
      "-e",
      `ENGINE_${id}=${dbGateEngine(profile.engine)}`
    ]
  })
  return [...connectionEnv, ...profileEnv]
}

const runDatabaseContainer = (
  project: DatabaseProjectRuntime,
  profiles: ReadonlyArray<StoredDatabaseProfile>,
  configHash: string
) =>
  Effect.gen(function*(_) {
    const projectNetworks = yield* _(inspectContainerNetworks(project.projectDir, project.containerName))
    const selectedNetwork = selectReachableNetwork(projectNetworks)
    if (selectedNetwork === null || selectedNetwork.ipAddress.length === 0) {
      return yield* _(Effect.fail(new ApiInternalError({ message: `Project container has no reachable network: ${project.containerName}` })))
    }
    const containerName = buildProjectDatabaseContainerName(project.containerName)
    const volumeName = buildProjectDatabaseVolumeName(project.projectDir)
    yield* _(
      dockerCapture(
        project.projectDir,
        [
          "run",
          "-d",
          "--name",
          containerName,
          "--label",
          `${projectDatabaseKindLabel}=${projectDatabaseKindValue}`,
          "--label",
          `${projectDatabaseProjectLabel}=${project.projectDir}`,
          "--label",
          `${projectDatabaseConfigHashLabel}=${configHash}`,
          "--network",
          selectedNetwork.name,
          "--mount",
          `type=volume,source=${volumeName},target=/root/.dbgate`,
          ...dbGateEnvArgs(profiles, selectedNetwork.ipAddress),
          dbGateImage()
        ],
        "docker run dbgate"
      ).pipe(
        Effect.asVoid,
        Effect.mapError((error) => toInternalDockerError("Failed to start DbGate container.", error))
      )
    )
    yield* _(
      Effect.forEach(
        projectNetworks.filter((entry) => entry.name !== selectedNetwork.name),
        (entry) => connectContainerToNetwork(project.projectDir, entry.name, containerName),
        { discard: true }
      )
    )
  })

const ensureDatabaseContainer = (
  project: DatabaseProjectRuntime,
  profiles: ReadonlyArray<StoredDatabaseProfile>
) =>
  Effect.gen(function*(_) {
    if (profiles.length === 0) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: "Save at least one database profile first." })))
    }
    const containerName = buildProjectDatabaseContainerName(project.containerName)
    const configHash = databasesConfigHash(profiles)
    const current = yield* _(inspectDatabaseContainerState(project.projectDir, containerName))
    if (current.status === "running" && current.configHash === configHash) {
      return
    }
    if (current.status !== "missing") {
      yield* _(removeDatabaseContainer(project, containerName))
    }
    yield* _(runDatabaseContainer(project, profiles, configHash))
  })

const projectDatabaseSession = (
  project: ProjectItem,
  state: DatabaseContainerState
): ProjectDatabaseSession => {
  const editorPath = renderProjectDatabaseProxyPath(project.projectDir)
  return {
    configHash: state.configHash,
    containerName: buildProjectDatabaseContainerName(project.containerName),
    editorPath,
    editorUrl: editorPath,
    projectId: project.projectDir,
    projectKey: projectShortKey(project.projectDir),
    status: state.status
  }
}

export const readProjectDatabaseSession = (
  projectId: string
): Effect.Effect<ProjectDatabaseSession, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const state = yield* _(inspectDatabaseContainerState(
      project.projectDir,
      buildProjectDatabaseContainerName(project.containerName)
    ))
    return projectDatabaseSession(project, state)
  })

export const openProjectDatabaseEditor = (
  projectId: string
): Effect.Effect<ProjectDatabaseSession, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const profiles = yield* _(readStoredProfiles(project))
    yield* _(ensureDatabaseContainer(project, profiles))
    const state = yield* _(inspectDatabaseContainerState(
      project.projectDir,
      buildProjectDatabaseContainerName(project.containerName)
    ))
    return projectDatabaseSession(project, state)
  })

export const restartProjectDatabaseEditor = (
  projectId: string
): Effect.Effect<ProjectDatabaseSession, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const containerName = buildProjectDatabaseContainerName(project.containerName)
    const profiles = yield* _(readStoredProfiles(project))
    yield* _(removeDatabaseContainer(project, containerName))
    yield* _(ensureDatabaseContainer(project, profiles))
    const state = yield* _(inspectDatabaseContainerState(project.projectDir, containerName))
    return projectDatabaseSession(project, state)
  })

const resolveProjectByKey = (
  projectKey: string
): Effect.Effect<DatabaseProjectLookup, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const index = yield* _(loadProjectIndex())
    if (index === null) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
    }
    const matches = index.configPaths
      .map((configPath) => ({ configPath, projectDir: dirname(configPath) }))
      .filter((project) => projectShortKey(project.projectDir) === projectKey)
    if (matches.length === 0) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
    }
    if (matches.length > 1) {
      return yield* _(Effect.fail(new ApiConflictError({ message: `Project key is ambiguous: ${projectKey}` })))
    }
    const match = matches[0]
    if (match === undefined) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
    }
    const status = yield* _(
      loadProjectStatus(match.configPath).pipe(
        Effect.mapError((cause) =>
          new ApiInternalError({
            message: `Failed to load project config for key: ${projectKey}`,
            cause
          })
        )
      )
    )
    return status === undefined
      ? yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
      : {
        containerName: status.config.template.containerName,
        projectDir: status.projectDir,
        projectId: status.projectDir
      }
  })

const resolveDatabaseProxyUpstream = (
  target: ProjectDatabaseProxyPath,
  requestUrl: string
): Effect.Effect<DatabaseProxyUpstream, DatabaseApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(resolveProjectByKey(target.projectKey))
    const containerName = buildProjectDatabaseContainerName(project.containerName)
    const initialState = yield* _(inspectDatabaseContainerState(project.projectDir, containerName))
    if (initialState.status !== "running") {
      const profiles = yield* _(readStoredProfiles(project))
      yield* _(ensureDatabaseContainer(project, profiles))
    }
    const runningState = yield* _(inspectDatabaseContainerState(project.projectDir, containerName))
    if (runningState.status !== "running") {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: `DbGate container is not running: ${containerName}` })))
    }
    const ipAddress = yield* _(ensureDatabaseReachableIp(project.projectDir, containerName))
    const proxyPath = renderProjectDatabaseProxyPath(project.projectId)
    const search = new URL(requestUrl, "http://localhost").search
    const upstreamUrl = new URL(`${target.upstreamPath}${search}`, `http://${ipAddress}:${dbGatePort}`)
    return {
      projectId: project.projectId,
      projectKey: target.projectKey,
      proxyPath,
      upstreamOrigin: upstreamUrl.origin,
      upstreamUrl
    }
  })

const hasRequestBody = (method: string): boolean => method !== "GET" && method !== "HEAD"

const copyProxyRequestHeaders = (
  request: HttpServerRequest.HttpServerRequest,
  proxyPath: string
): Headers => {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    const normalized = key.toLowerCase()
    if (typeof value === "string" && !hopByHopRequestHeaders.has(normalized)) {
      headers.set(key, value)
    }
  }
  headers.set("accept-encoding", "identity")
  headers.set("x-forwarded-prefix", proxyPath)
  if (typeof request.headers["host"] === "string") {
    headers.set("x-forwarded-host", request.headers["host"])
  }
  return headers
}

const copyProxyResponseHeaders = (
  response: Response,
  proxyPath: string,
  upstreamOrigin: string,
  externalPrefix: string,
  projectKey: string
): HttpHeaders.Input => {
  const headers: Array<readonly [string, string]> = []
  let hasCacheControl = false
  for (const [key, value] of response.headers.entries()) {
    const normalized = key.toLowerCase()
    if (!hopByHopResponseHeaders.has(normalized)) {
      if (normalized === "cache-control") {
        hasCacheControl = true
      }
      headers.push([key, normalized === "location"
        ? rewriteProxyLocation(value, proxyPath, upstreamOrigin, externalPrefix)
        : value])
    }
  }
  if (!hasCacheControl) {
    headers.push(["cache-control", "no-store"])
  }
  headers.push(["set-cookie", `${projectDatabaseCookieName}=${projectKey}; Path=/; SameSite=Lax`])
  return headers
}

const fetchDatabaseUpstream = (
  request: HttpServerRequest.HttpServerRequest,
  upstream: DatabaseProxyUpstream
) =>
  Effect.gen(function*(_) {
    const requestBody = hasRequestBody(request.method)
      ? yield* _(request.arrayBuffer)
      : undefined
    const init = {
      headers: copyProxyRequestHeaders(request, upstream.proxyPath),
      method: request.method,
      redirect: "manual" as const,
      ...(requestBody !== undefined && requestBody.byteLength > 0
        ? { body: new Uint8Array(requestBody) }
        : {})
    }
    return yield* _(
      Effect.tryPromise({
        try: () => fetch(upstream.upstreamUrl, init),
        catch: (cause) =>
          new ApiInternalError({
            message: "Failed to proxy DbGate.",
            cause
          })
      })
    )
  })

export const proxyProjectDatabase = (
  request: HttpServerRequest.HttpServerRequest,
  target: ProjectDatabaseProxyPath
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  DatabaseApiError | HttpServerError.RequestError | PlatformError,
  ListProjectsContext
> =>
  Effect.gen(function*(_) {
    const upstream = yield* _(resolveDatabaseProxyUpstream(target, request.url))
    const upstreamResponse = yield* _(fetchDatabaseUpstream(request, upstream).pipe(
      Effect.retry(databaseProxyRetrySchedule)
    ))
    const headers = copyProxyResponseHeaders(
      upstreamResponse,
      upstream.proxyPath,
      upstream.upstreamOrigin,
      normalizeForwardedPrefix(request.headers["x-forwarded-prefix"]),
      upstream.projectKey
    )
    if (request.method === "HEAD" || upstreamResponse.body === null) {
      return HttpServerResponse.empty({ headers, status: upstreamResponse.status })
    }
    return HttpServerResponse.stream(
      Stream.fromReadableStream(
        () => upstreamResponse.body as ReadableStream<Uint8Array>,
        (cause) => new ApiInternalError({ message: "Failed to read DbGate proxy body.", cause })
      ),
      {
        headers,
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText
      }
    )
  })

const denyUpgrade = (socket: Duplex): void => {
  socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
  socket.destroy()
}

const rawDataToBuffer = (data: RawData): Buffer =>
  Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(data)

const bridgeSockets = (
  clientSocket: WebSocket,
  upstream: WebSocket
): void => {
  const pending: Array<{ readonly data: Buffer; readonly isBinary: boolean }> = []
  const sendWhenOpen = (socket: WebSocket, data: Buffer, isBinary: boolean): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data, { binary: isBinary })
    }
  }
  const flushPending = (): void => {
    for (const message of pending.splice(0)) {
      sendWhenOpen(upstream, message.data, message.isBinary)
    }
  }
  clientSocket.on("message", (data, isBinary) => {
    const buffer = rawDataToBuffer(data)
    if (upstream.readyState === WebSocket.OPEN) {
      sendWhenOpen(upstream, buffer, isBinary)
      return
    }
    pending.push({ data: buffer, isBinary })
  })
  upstream.on("message", (data, isBinary) => {
    sendWhenOpen(clientSocket, rawDataToBuffer(data), isBinary)
  })
  upstream.on("open", flushPending)
  clientSocket.on("close", () => {
    upstream.close()
  })
  upstream.on("close", () => {
    clientSocket.close()
  })
  upstream.on("error", () => {
    clientSocket.close()
  })
}

const connectDatabaseWebSocket = (
  webSocketServer: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  upstreamUrl: string
): void => {
  webSocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
    const upstream = new WebSocket(upstreamUrl)
    upstream.on("error", () => {
      clientSocket.close()
    })
    upstream.on("close", () => {
      clientSocket.close()
    })
    try {
      bridgeSockets(clientSocket, upstream)
    } catch {
      clientSocket.close()
      upstream.close()
    }
  })
}

export const attachProjectDatabaseWebSocketServer = (server: HttpServer): void => {
  const webSocketServer = new WebSocketServer({ noServer: true })
  server.on("upgrade", (request, socket, head) => {
    const parsed = new URL(request.url ?? "/", "http://localhost")
    const target = parseProjectDatabaseProxyPath(parsed.pathname)
    if (target === null) {
      return
    }
    Effect.runFork(
      resolveDatabaseProxyUpstream(target, request.url ?? "/").pipe(
        Effect.provide(NodeContext.layer),
        Effect.map((upstream) => {
          const wsUrl = new URL(upstream.upstreamUrl.toString())
          wsUrl.protocol = "ws:"
          return wsUrl.toString()
        }),
        Effect.match({
          onFailure: () => {
            denyUpgrade(socket)
          },
          onSuccess: (upstreamUrl) => {
            connectDatabaseWebSocket(webSocketServer, request, socket, head, upstreamUrl)
          }
        })
      )
    )
  })
}
