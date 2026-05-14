import {
  type AppError,
  listProjectItems,
  prepareProjectSsh,
  probeProjectSshReady,
  renderError,
  waitForProjectSshReady
} from "@effect-template/lib"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { parseInspectNetworkEntry } from "@effect-template/lib/shell/docker-inspect-parse"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import type * as PlatformPath from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import os from "node:os"
import path from "node:path"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer, type RawData } from "ws"

import type { TerminalSession, TerminalSessionStatus } from "../api/contracts.js"
import { ApiBadRequestError, ApiConflictError, ApiInternalError, ApiNotFoundError, describeUnknown } from "../api/errors.js"
import { emitProjectEvent, latestProjectCursor } from "./events.js"
import {
  planTerminalImageFetch,
  terminalImageFetchMaxBytes
} from "./terminal-image-fetch-core.js"
import {
  createTerminalImagePastePlan,
  terminalImagePasteDirectory,
  type TerminalImagePastePayload
} from "./terminal-image-paste-core.js"
import {
  appendTerminalOutput,
  emptyTerminalOutputBuffer,
  renderTerminalOutputBuffer,
  type TerminalOutputBuffer
} from "./terminal-output-buffer.js"
import { spawnPtyBridge, type PtyBridge } from "./pty-bridge.js"
import { getProject, getProjectItemById, getProjectItemByKey, upProject } from "./projects.js"
import { attachWebSocketHeartbeat } from "./websocket-heartbeat.js"

type TerminalClientMessage =
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | ({ readonly type: "image" } & TerminalImagePastePayload)
  | { readonly type: "close" }

type TerminalServerMessage =
  | { readonly type: "ready"; readonly session: TerminalSession }
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "exit"; readonly exitCode: number | null; readonly signal: number | null }
  | { readonly type: "error"; readonly message: string }

type TerminalRecord = {
  session: TerminalSession
  pty: PtyBridge | null
  sockets: Set<WebSocket>
  attachTimeout: ReturnType<typeof setTimeout> | null
  detachTimeout: ReturnType<typeof setTimeout> | null
  outputBuffer: TerminalOutputBuffer
  projectContainerName: string
  projectDisplayName: string
  projectId: string
  projectKey: string
  projectTargetDir: string
  prepared: ReturnType<typeof prepareProjectSsh>
}

type TerminalSessionRuntime =
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | PlatformPath.Path

type DurableTerminalSession = {
  readonly id: string
  readonly projectId: string
  readonly projectKey: string
  readonly projectDisplayName: string
  readonly tmuxName: string
  readonly sshCommand: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly status: TerminalSessionStatus
  readonly startedAt?: string | undefined
  readonly closedAt?: string | undefined
}

type DurableTerminalSessionFile = {
  readonly schemaVersion: 1
  readonly sessions: ReadonlyArray<DurableTerminalSession>
}

const records = new Map<string, TerminalRecord>()
const terminalWsPathPattern = /^(?:\/api)?\/projects\/([^/]+)\/terminal-sessions\/([^/]+)\/ws$/u
const terminalWsByKeyPathPattern = /^(?:\/api)?\/projects\/by-key\/([^/]+)\/terminal-sessions\/([^/]+)\/ws$/u
const terminalSessionStateRelativePath: ReadonlyArray<string> = [".orch", "state", "terminal-sessions.json"]
const tmuxMissingMessage =
  "tmux is not installed in this project image. Apply or rebuild the project image, then reopen this SSH terminal session."

const TerminalClientMessageSchema = Schema.parseJson(
  Schema.Union(
    Schema.Struct({
      type: Schema.Literal("input"),
      data: Schema.String
    }),
    Schema.Struct({
      type: Schema.Literal("resize"),
      cols: Schema.Number,
      rows: Schema.Number
    }),
    Schema.Struct({
      type: Schema.Literal("image"),
      data: Schema.String,
      mediaType: Schema.String,
      name: Schema.String,
      size: Schema.Number
    }),
    Schema.Struct({
      type: Schema.Literal("close")
    })
  )
)

const DurableTerminalSessionSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  projectDisplayName: Schema.String,
  tmuxName: Schema.String,
  sshCommand: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  status: Schema.Literal("ready", "attached", "exited", "failed"),
  startedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.String)
})

const DurableTerminalSessionFileSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sessions: Schema.Array(DurableTerminalSessionSchema)
})

const DurableTerminalSessionFileJsonSchema = Schema.parseJson(DurableTerminalSessionFileSchema)

export const clearTerminalSessionRuntimeForTest = (): void => {
  for (const record of records.values()) {
    clearAttachTimeout(record)
    clearDetachTimeout(record)
    if (record.pty !== null) {
      const pty = record.pty
      record.pty = null
      pty.kill()
    }
    closeRecordSockets(record)
  }
  records.clear()
}

const nowIso = (): string => new Date().toISOString()

const terminalSessionStatePath = (projectId: string): string =>
  path.join(projectId, ...terminalSessionStateRelativePath)

const emptyTerminalSessionFile = (): DurableTerminalSessionFile => ({
  schemaVersion: 1,
  sessions: []
})

const decodeTerminalSessionFile = (input: string): DurableTerminalSessionFile | null =>
  Either.match(ParseResult.decodeUnknownEither(DurableTerminalSessionFileJsonSchema)(input), {
    onLeft: () => null,
    onRight: (value) => value
  })

const readTerminalSessionFile = (projectId: string): DurableTerminalSessionFile => {
  const statePath = terminalSessionStatePath(projectId)
  if (!existsSync(statePath)) {
    return emptyTerminalSessionFile()
  }
  try {
    const decoded = decodeTerminalSessionFile(readFileSync(statePath, "utf8"))
    return decoded ?? emptyTerminalSessionFile()
  } catch {
    return emptyTerminalSessionFile()
  }
}

const writeTerminalSessionFile = (
  projectId: string,
  state: DurableTerminalSessionFile
): void => {
  const statePath = terminalSessionStatePath(projectId)
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
}

const tmuxNameForSessionId = (sessionId: string): string => {
  const normalized = sessionId.replace(/[^A-Za-z0-9_-]/gu, "-").replace(/-+/gu, "-")
  return `docker-git-${normalized.slice(0, 80)}`
}

const terminalSessionFromDurable = (
  durable: DurableTerminalSession,
  attachedClients: number
): TerminalSession => ({
  id: durable.id,
  projectId: durable.projectId,
  sshCommand: durable.sshCommand,
  status: attachedClients > 0
    ? "attached"
    : durable.status === "attached"
      ? "ready"
      : durable.status,
  createdAt: durable.createdAt,
  attachedClients,
  ...(durable.startedAt === undefined ? {} : { startedAt: durable.startedAt }),
  ...(durable.closedAt === undefined ? {} : { closedAt: durable.closedAt })
})

const durableFromSession = (
  args: {
    readonly projectDisplayName: string
    readonly projectKey: string
    readonly session: TerminalSession
    readonly tmuxName: string
    readonly updatedAt: string
  }
): DurableTerminalSession => ({
  id: args.session.id,
  projectId: args.session.projectId,
  projectKey: args.projectKey,
  projectDisplayName: args.projectDisplayName,
  tmuxName: args.tmuxName,
  sshCommand: args.session.sshCommand,
  createdAt: args.session.createdAt,
  updatedAt: args.updatedAt,
  status: args.session.status,
  ...(args.session.startedAt === undefined ? {} : { startedAt: args.session.startedAt }),
  ...(args.session.closedAt === undefined ? {} : { closedAt: args.session.closedAt })
})

const upsertDurableSession = (
  projectId: string,
  durable: DurableTerminalSession
): void => {
  const state = readTerminalSessionFile(projectId)
  const sessions = state.sessions.filter((session) => session.id !== durable.id)
  writeTerminalSessionFile(projectId, {
    schemaVersion: 1,
    sessions: [...sessions, durable]
  })
}

const patchDurableSession = (
  record: TerminalRecord,
  patch: Partial<TerminalSession>
): void => {
  const state = readTerminalSessionFile(record.projectId)
  const updatedAt = nowIso()
  const sessions = state.sessions.map((session) =>
    session.id === record.session.id
      ? durableFromSession({
        projectDisplayName: record.projectDisplayName,
        projectKey: record.projectKey,
        session: {
          ...terminalSessionFromDurable(session, 0),
          ...patch
        },
        tmuxName: session.tmuxName,
        updatedAt
      })
      : session
  )
  writeTerminalSessionFile(record.projectId, {
    schemaVersion: 1,
    sessions
  })
}

const deleteDurableSession = (
  projectId: string,
  sessionId: string
): boolean => {
  const state = readTerminalSessionFile(projectId)
  const sessions = state.sessions.filter((session) => session.id !== sessionId)
  if (sessions.length === state.sessions.length) {
    return false
  }
  writeTerminalSessionFile(projectId, {
    schemaVersion: 1,
    sessions
  })
  return true
}

const findDurableSession = (
  projectId: string,
  sessionId: string
): DurableTerminalSession | null =>
  readTerminalSessionFile(projectId).sessions.find((session) => session.id === sessionId) ?? null

const isAppError = (value: unknown): value is AppError =>
  typeof value === "object" && value !== null && "_tag" in value

const updateSession = (
  record: TerminalRecord,
  patch: Partial<TerminalSession>
): void => {
  record.session = {
    ...record.session,
    ...patch
  }
  records.set(record.session.id, record)
  patchDurableSession(record, patch)
}

const attachedClientCount = (record: TerminalRecord): number => {
  for (const socket of [...record.sockets]) {
    if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      record.sockets.delete(socket)
    }
  }
  return record.sockets.size
}

const syncAttachedClientCount = (record: TerminalRecord): void => {
  updateSession(record, { attachedClients: attachedClientCount(record) })
}

const toApiInternalError = (error: unknown): ApiInternalError =>
  error instanceof ApiInternalError
    ? error
    : new ApiInternalError({
      message: isAppError(error) ? renderError(error) : describeUnknown(error),
      cause: error
    })

const toTerminalSessionLookupError = (
  error: unknown
): ApiConflictError | ApiInternalError | ApiNotFoundError =>
  error instanceof ApiConflictError || error instanceof ApiInternalError || error instanceof ApiNotFoundError
    ? error
    : toApiInternalError(error)

const normalizeSshKeyPermissions = (sshKeyPath: string | null) =>
  sshKeyPath === null
    ? Effect.void
    : FileSystem.FileSystem.pipe(
      Effect.flatMap((fs) => fs.chmod(sshKeyPath, 0o600).pipe(Effect.orElseSucceed(() => void 0)))
    )

type ContainerNetworkEntry = {
  readonly ipAddress: string
  readonly name: string
}

const dockerGitApiContainerName = (): string =>
  process.env["DOCKER_GIT_API_CONTAINER_NAME"]?.trim() || os.hostname().trim() || "docker-git-api"

const isContainerizedController = (): boolean => {
  const configuredName = process.env["DOCKER_GIT_API_CONTAINER_NAME"]?.trim()
  return (configuredName !== undefined && configuredName.length > 0) || existsSync("/.dockerenv")
}

const parseContainerNetworkEntries = (output: string): ReadonlyArray<ContainerNetworkEntry> =>
  output
    .trim()
    .split(/\r?\n/u)
    .flatMap((line) => parseInspectNetworkEntry(line))
    .map(([name, ipAddress]) => ({ name, ipAddress }))

const selectReachableProjectNetwork = (
  projectEntries: ReadonlyArray<ContainerNetworkEntry>,
  controllerEntries: ReadonlyArray<ContainerNetworkEntry>
): ContainerNetworkEntry | null =>
  projectEntries.find((entry) =>
    entry.name !== "bridge" && controllerEntries.some((controllerEntry) => controllerEntry.name === entry.name)
  ) ??
    projectEntries.find((entry) =>
      controllerEntries.some((controllerEntry) => controllerEntry.name === entry.name)
    ) ??
    null

const selectFallbackProjectNetwork = (
  entries: ReadonlyArray<ContainerNetworkEntry>
): ContainerNetworkEntry | null =>
  isContainerizedController()
    ? entries.find((entry) => entry.name === "bridge") ?? entries[0] ?? null
    : null

const inspectContainerNetworks = (
  containerName: string
) =>
  runCommandCapture(
    {
      cwd: process.cwd(),
      command: "docker",
      args: [
        "inspect",
        "-f",
        String.raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`,
        containerName
      ]
    },
    [0],
    (exitCode) => new CommandFailedError({ command: "docker inspect networks", exitCode })
  ).pipe(Effect.map(parseContainerNetworkEntries))

const connectContainerToNetwork = (
  networkName: string,
  containerName: string
) =>
  networkName === "bridge"
    ? Effect.succeed(true)
    : runCommandCapture(
      {
        cwd: process.cwd(),
        command: "docker",
        args: ["network", "connect", networkName, containerName]
      },
      [0],
      (exitCode) => new CommandFailedError({ command: `docker network connect ${networkName}`, exitCode })
    ).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false)
    )

const resolveControllerReachableProject = (
  projectItem: ProjectItem
) =>
  Effect.gen(function*(_) {
    const controllerContainer = dockerGitApiContainerName()
    const networkEntries = yield* _(inspectContainerNetworks(projectItem.containerName).pipe(Effect.orElseSucceed(() => [])))
    const controllerNetworks = yield* _(inspectContainerNetworks(controllerContainer).pipe(Effect.orElseSucceed(() => [])))
    const alreadyReachable = selectReachableProjectNetwork(networkEntries, controllerNetworks)
    if (alreadyReachable !== null) {
      return {
        ...projectItem,
        ipAddress: alreadyReachable.ipAddress
      }
    }
    yield* _(
      Effect.forEach(
        networkEntries.filter((entry) => entry.name !== "bridge"),
        (entry) => connectContainerToNetwork(entry.name, controllerContainer),
        { discard: true }
      )
    )
    const refreshedControllerNetworks = yield* _(
      inspectContainerNetworks(controllerContainer).pipe(Effect.orElseSucceed(() => []))
    )
    const preferredNetwork = selectReachableProjectNetwork(networkEntries, refreshedControllerNetworks) ??
      selectFallbackProjectNetwork(networkEntries)
    if (preferredNetwork === null) {
      return projectItem
    }
    return {
      ...projectItem,
      ipAddress: preferredNetwork.ipAddress
    }
  })

const encodeServerMessage = (message: TerminalServerMessage): string => JSON.stringify(message)

const renderPreparedSshCommand = (prepared: ReturnType<typeof prepareProjectSsh>): string =>
  [prepared.command, ...prepared.args].join(" ")

const sendServerMessage = (socket: WebSocket | null, message: TerminalServerMessage): void => {
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(encodeServerMessage(message))
}

const broadcastServerMessage = (record: TerminalRecord, message: TerminalServerMessage): void => {
  for (const socket of record.sockets) {
    sendServerMessage(socket, message)
  }
}

const sendTerminalOutput = (record: TerminalRecord, data: string): void => {
  record.outputBuffer = appendTerminalOutput(record.outputBuffer, data)
  broadcastServerMessage(record, { type: "output", data })
}

const replayTerminalOutput = (record: TerminalRecord, socket: WebSocket): void => {
  const data = renderTerminalOutputBuffer(record.outputBuffer)
  if (data.length > 0) {
    sendServerMessage(socket, { type: "output", data })
  }
}

const clearAttachTimeout = (record: TerminalRecord): void => {
  if (record.attachTimeout !== null) {
    clearTimeout(record.attachTimeout)
    record.attachTimeout = null
  }
}

const clearDetachTimeout = (record: TerminalRecord): void => {
  if (record.detachTimeout !== null) {
    clearTimeout(record.detachTimeout)
    record.detachTimeout = null
  }
}

const closeSocket = (socket: WebSocket | null): void => {
  if (socket === null || socket.readyState === WebSocket.CLOSED) {
    return
  }
  socket.close()
}

const closeRecordSockets = (record: TerminalRecord): void => {
  for (const socket of record.sockets) {
    closeSocket(socket)
  }
  record.sockets.clear()
}

const cleanupRecord = (record: TerminalRecord): void => {
  clearAttachTimeout(record)
  clearDetachTimeout(record)
  if (record.pty !== null) {
    const pty = record.pty
    record.pty = null
    pty.kill()
  }
  closeRecordSockets(record)
  records.delete(record.session.id)
}

const detachRecordPty = (record: TerminalRecord): void => {
  if (record.pty === null) {
    updateSession(record, {
      attachedClients: attachedClientCount(record),
      status: "ready"
    })
    return
  }
  const pty = record.pty
  record.pty = null
  updateSession(record, {
    attachedClients: attachedClientCount(record),
    status: "ready"
  })
  pty.kill()
}

const finalizeRecord = (
  record: TerminalRecord,
  status: Extract<TerminalSessionStatus, "exited" | "failed">,
  exitCode: number | null,
  signal: number | null
): void => {
  const nextStatus = exitCode === 0 || exitCode === 130 ? "ready" : status
  broadcastServerMessage(record, { type: "exit", exitCode, signal })
  closeRecordSockets(record)
  record.pty = null
  clearAttachTimeout(record)
  clearDetachTimeout(record)
  updateSession(record, {
    attachedClients: attachedClientCount(record),
    closedAt: nowIso(),
    exitCode: exitCode ?? undefined,
    signal: signal ?? undefined,
    status: nextStatus
  })
}

const decodeClientMessage = (raw: RawData): TerminalClientMessage | null =>
  Either.getOrNull(
    ParseResult.decodeUnknownEither(TerminalClientMessageSchema)(
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString("utf8")
          : raw instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(raw)).toString("utf8")
            : raw.toString("utf8")
    )
  )

const clampTerminalSize = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback

const writePtyInput = (pty: PtyBridge | null, data: string): void => {
  if (pty === null) {
    return
  }
  try {
    pty.write(data)
  } catch {
    return
  }
}

const shellQuote = (value: string): string => `'${value.replace(/'/gu, "'\\''")}'`

const writeBufferToProjectContainer = (
  containerName: string,
  containerPath: string,
  buffer: Buffer
): Effect.Effect<void, ApiInternalError> =>
  Effect.async((resume) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "-u",
        "dev",
        containerName,
        "bash",
        "--noprofile",
        "--norc",
        "-c",
        `mkdir -p ${shellQuote(terminalImagePasteDirectory)} && cat > ${shellQuote(containerPath)}`
      ],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "ignore", "pipe"]
      }
    )
    const stderrChunks: Array<Buffer> = []
    let completed = false
    const resumeOnce = (effect: Effect.Effect<void, ApiInternalError>): void => {
      if (completed) {
        return
      }
      completed = true
      resume(effect)
    }
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.stdin.on("error", (error) => {
      resumeOnce(Effect.fail(new ApiInternalError({
        message: `Failed to write pasted image to ${containerName}.`,
        cause: error
      })))
    })
    child.on("error", (error) => {
      resumeOnce(Effect.fail(new ApiInternalError({
        message: `Failed to run docker exec for ${containerName}.`,
        cause: error
      })))
    })
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resumeOnce(Effect.void)
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim()
      resumeOnce(Effect.fail(new ApiInternalError({
        message: stderr.length > 0
          ? `Failed to save pasted image: ${stderr}`
          : `Failed to save pasted image; docker exec exited with code ${exitCode ?? "unknown"}.`
      })))
    })
    child.stdin.end(buffer)
  })

const readBufferFromProjectContainer = (
  containerName: string,
  containerPath: string,
  maxBytes: number
): Effect.Effect<Buffer, ApiInternalError | ApiBadRequestError | ApiNotFoundError> =>
  Effect.async((resume) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-u",
        "dev",
        containerName,
        "cat",
        "--",
        containerPath
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"]
      }
    )
    const stdoutChunks: Array<Buffer> = []
    const stderrChunks: Array<Buffer> = []
    let totalBytes = 0
    let exceededLimit = false
    let completed = false
    const resumeOnce = (
      effect: Effect.Effect<Buffer, ApiInternalError | ApiBadRequestError | ApiNotFoundError>
    ): void => {
      if (completed) {
        return
      }
      completed = true
      resume(effect)
    }
    child.stdout.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > maxBytes) {
        exceededLimit = true
        try {
          child.kill()
        } catch {
          // ignore — close handler will resume
        }
        return
      }
      stdoutChunks.push(buffer)
    })
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.on("error", (error) => {
      resumeOnce(Effect.fail(new ApiInternalError({
        message: `Failed to run docker exec for ${containerName}.`,
        cause: error
      })))
    })
    child.on("close", (exitCode) => {
      if (exceededLimit) {
        resumeOnce(Effect.fail(new ApiBadRequestError({
          message: `Image exceeds maximum size of ${maxBytes} bytes.`
        })))
        return
      }
      if (exitCode === 0) {
        resumeOnce(Effect.succeed(Buffer.concat(stdoutChunks)))
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim()
      if (/no such file|not a directory|not found/iu.test(stderr)) {
        resumeOnce(Effect.fail(new ApiNotFoundError({
          message: `Image not found at ${containerPath}.`
        })))
        return
      }
      resumeOnce(Effect.fail(new ApiInternalError({
        message: stderr.length > 0
          ? `Failed to read image: ${stderr}`
          : `Failed to read image; docker exec exited with code ${exitCode ?? "unknown"}.`
      })))
    })
  })

const saveTerminalImagePaste = (
  record: TerminalRecord,
  payload: TerminalImagePastePayload
): Effect.Effect<string, ApiInternalError> =>
  Effect.gen(function*(_) {
    const plan = createTerminalImagePastePlan(payload, randomUUID())
    if (plan._tag === "InvalidTerminalImagePaste") {
      return yield* _(Effect.fail(new ApiInternalError({ message: plan.message })))
    }
    const bytes = Buffer.from(plan.normalizedBase64, "base64")
    if (bytes.length !== plan.decodedBytes) {
      return yield* _(Effect.fail(new ApiInternalError({ message: "Decoded image size changed during upload." })))
    }
    yield* _(writeBufferToProjectContainer(record.projectContainerName, plan.containerPath, bytes))
    return plan.containerPath
  })

const terminalOutputLine = (line: string): string => `\r\n[docker-git] ${line}\r\n`

const handleImagePasteMessage = (
  record: TerminalRecord,
  message: Extract<TerminalClientMessage, { readonly type: "image" }>
): void => {
  Effect.runFork(
    saveTerminalImagePaste(record, message).pipe(
      Effect.tap((containerPath) =>
        Effect.sync(() => {
          sendTerminalOutput(record, terminalOutputLine(`Pasted image saved: ${containerPath}`))
          writePtyInput(record.pty, `${containerPath} `)
        })
      ),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          sendTerminalOutput(record, terminalOutputLine(`Failed to paste image: ${error.message}`))
        })
      )
    )
  )
}

const resizePty = (pty: PtyBridge | null, cols: number, rows: number): void => {
  if (pty === null) {
    return
  }
  try {
    pty.resize(cols, rows)
  } catch {
    return
  }
}

const renderRemoteTmuxCommand = (record: TerminalRecord): string => {
  const tmuxName = findDurableSession(record.projectId, record.session.id)?.tmuxName ?? tmuxNameForSessionId(
    record.session.id
  )
  const script = [
    `if ! command -v tmux >/dev/null 2>&1; then printf '%s\\n' ${shellQuote(tmuxMissingMessage)} >&2; exit 127; fi`,
    `exec tmux new-session -A -s ${shellQuote(tmuxName)} -c ${shellQuote(record.projectTargetDir)}`
  ].join("; ")
  return `sh -lc ${shellQuote(script)}`
}

const preparedArgsForTmuxSession = (record: TerminalRecord): ReadonlyArray<string> => [
  ...record.prepared.args,
  renderRemoteTmuxCommand(record)
]

const startTerminalPty = (
  record: TerminalRecord,
  cols: number,
  rows: number
): void => {
  if (record.pty !== null) {
    resizePty(record.pty, clampTerminalSize(cols, 120), clampTerminalSize(rows, 32))
    return
  }
  const resolvedCols = clampTerminalSize(cols, 120)
  const resolvedRows = clampTerminalSize(rows, 32)
  record.outputBuffer = emptyTerminalOutputBuffer
  const pty = spawnPtyBridge({
    args: preparedArgsForTmuxSession(record),
    command: record.prepared.command,
    cols: resolvedCols,
    cwd: record.prepared.cwd,
    rows: resolvedRows
  })
  record.pty = pty
  updateSession(record, {
    startedAt: nowIso(),
    status: "attached"
  })
  pty.onData((data) => {
    sendTerminalOutput(record, data)
  })
  pty.onExit(({ exitCode, signal }) => {
    if (record.pty !== pty) {
      return
    }
    finalizeRecord(
      record,
      exitCode === 0 || exitCode === 130 ? "exited" : "failed",
      exitCode ?? null,
      signal ?? null
    )
  })
}

const registerRecord = (
  projectId: string,
  projectKey: string,
  projectDisplayName: string,
  prepared: ReturnType<typeof prepareProjectSsh>,
  projectContainerName: string,
  projectTargetDir: string,
  sessionId: string = randomUUID()
): TerminalSession => {
  const createdAt = nowIso()
  const session: TerminalSession = {
    attachedClients: 0,
    createdAt,
    id: sessionId,
    projectId,
    sshCommand: renderPreparedSshCommand(prepared),
    status: "ready"
  }
  const tmuxName = tmuxNameForSessionId(session.id)
  upsertDurableSession(
    projectId,
    durableFromSession({
      projectDisplayName,
      projectKey,
      session,
      tmuxName,
      updatedAt: createdAt
    })
  )
  const record: TerminalRecord = {
    attachTimeout: null,
    detachTimeout: null,
    outputBuffer: emptyTerminalOutputBuffer,
    prepared,
    projectContainerName,
    projectDisplayName,
    projectId,
    projectKey,
    projectTargetDir,
    pty: null,
    session,
    sockets: new Set<WebSocket>()
  }
  records.set(session.id, record)
  return session
}

const registerHydratedRecord = (
  durable: DurableTerminalSession,
  prepared: ReturnType<typeof prepareProjectSsh>,
  projectItem: ProjectItem
): TerminalRecord => {
  const record: TerminalRecord = {
    attachTimeout: null,
    detachTimeout: null,
    outputBuffer: emptyTerminalOutputBuffer,
    prepared,
    projectContainerName: projectItem.containerName,
    projectDisplayName: durable.projectDisplayName,
    projectId: durable.projectId,
    projectKey: durable.projectKey,
    projectTargetDir: projectItem.targetDir,
    pty: null,
    session: terminalSessionFromDurable(durable, 0),
    sockets: new Set<WebSocket>()
  }
  records.set(record.session.id, record)
  return record
}

const prepareRuntimeRecord = (
  durable: DurableTerminalSession,
  projectItem: ProjectItem
): Effect.Effect<TerminalRecord, ApiInternalError, TerminalSessionRuntime> =>
  Effect.gen(function*(_) {
    const reachableProjectItem = yield* _(resolveControllerReachableProject(projectItem).pipe(Effect.mapError(toApiInternalError)))
    yield* _(normalizeSshKeyPermissions(reachableProjectItem.sshKeyPath))
    return registerHydratedRecord(durable, prepareProjectSsh(reachableProjectItem), reachableProjectItem)
  })

const hydrateProjectTerminalRecord = (
  projectItem: ProjectItem,
  sessionId: string
): Effect.Effect<TerminalRecord, ApiNotFoundError | ApiInternalError, TerminalSessionRuntime> =>
  Effect.gen(function*(_) {
    const existing = records.get(sessionId)
    if (existing !== undefined && existing.projectId === projectItem.projectDir) {
      return existing
    }
    const durable = findDurableSession(projectItem.projectDir, sessionId)
    if (durable === null) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` })))
    }
    return yield* _(prepareRuntimeRecord(durable, projectItem))
  })

const hydrateTerminalRecordByProjectId = (
  projectId: string,
  sessionId: string
): Effect.Effect<TerminalRecord, ApiConflictError | ApiNotFoundError | ApiInternalError, TerminalSessionRuntime> =>
  getProjectItemById(projectId).pipe(
    Effect.mapError(toTerminalSessionLookupError),
    Effect.flatMap((projectItem) => hydrateProjectTerminalRecord(projectItem, sessionId))
  )

const hydrateTerminalRecordByProjectKey = (
  projectKey: string,
  sessionId: string
): Effect.Effect<TerminalRecord, ApiConflictError | ApiNotFoundError | ApiInternalError, TerminalSessionRuntime> =>
  getProjectItemByKey(projectKey).pipe(
    Effect.mapError(toTerminalSessionLookupError),
    Effect.flatMap((projectItem) => hydrateProjectTerminalRecord(projectItem, sessionId))
  )

const emitTerminalStatus = (projectId: string, phase: string, message: string) =>
  Effect.sync(() => {
    emitProjectEvent(projectId, "project.deployment.status", { phase, message })
  })

const emitTerminalSessionCreated = (
  projectId: string,
  sessionId: string,
  requestId?: string
) =>
  Effect.sync(() => {
    emitProjectEvent(projectId, "project.ssh.session", {
      phase: "created",
      sessionId,
      ...(requestId === undefined ? {} : { requestId })
    })
  })

const emitTerminalSessionFailure = (
  projectId: string,
  requestId: string,
  message: string
) =>
  Effect.sync(() => {
    emitProjectEvent(projectId, "project.deployment.status", {
      phase: "ssh.failed",
      message,
      requestId
    })
  })

export const createTerminalSession = (
  projectId: string,
  options: {
    readonly requestId?: string
  } = {}
) =>
  Effect.gen(function*(_) {
    yield* _(emitTerminalStatus(projectId, "ssh.prepare", "Preparing SSH session"))
    const loadedProjectItem = yield* _(getProjectItemById(projectId))
    const projectItem = yield* _(resolveControllerReachableProject(loadedProjectItem))
    yield* _(normalizeSshKeyPermissions(projectItem.sshKeyPath))
    const sshAlreadyReady = yield* _(probeProjectSshReady(projectItem).pipe(Effect.orElseSucceed(() => false)))

    if (sshAlreadyReady) {
      yield* _(emitTerminalStatus(projectId, "ssh.fast-ready", "SSH is already ready"))
      const project = yield* _(getProject(projectId))
      const prepared = prepareProjectSsh(projectItem)
      const session = registerRecord(
        projectId,
        project.projectKey,
        project.displayName,
        prepared,
        projectItem.containerName,
        projectItem.targetDir,
        options.requestId
      )
      yield* _(emitTerminalSessionCreated(projectId, session.id, options.requestId))
      return { project, session }
    }

    const project = yield* _(upProject(projectId, undefined, true, { startupMode: "ssh-open" }))
    const refreshedProjectItem = yield* _(getProjectItemById(projectId))
    const reachableProjectItem = yield* _(resolveControllerReachableProject(refreshedProjectItem))
    yield* _(normalizeSshKeyPermissions(reachableProjectItem.sshKeyPath))
    yield* _(emitTerminalStatus(projectId, "ssh.wait", "Waiting for SSH"))
    yield* _(waitForProjectSshReady(reachableProjectItem).pipe(Effect.mapError(toApiInternalError)))
    yield* _(emitTerminalStatus(projectId, "ssh.ready", "SSH is ready"))
    const prepared = prepareProjectSsh(reachableProjectItem)
    const session = registerRecord(
      projectId,
      project.projectKey,
      project.displayName,
      prepared,
      reachableProjectItem.containerName,
      reachableProjectItem.targetDir,
      options.requestId
    )
    yield* _(emitTerminalSessionCreated(projectId, session.id, options.requestId))
    yield* _(emitTerminalStatus(projectId, "ssh.post-start", "Post-start self-heal continues in background"))
    return { project, session }
  })

// CHANGE: start SSH terminal creation asynchronously for web clients behind request timeouts
// WHY: long-running SSH startup can exceed Cloudflare tunnel request limits before attach is ready
// QUOTE(ТЗ): "всё равно не работает"
// REF: user-message-2026-05-07-terminal-524
// SOURCE: n/a
// FORMAT THEOREM: ∀r: accepted(r) → ◇(created(r) ∨ failed(r))
// PURITY: SHELL
// EFFECT: Effect<StartProjectTerminalSessionAccepted, never, Scope>
// INVARIANT: the returned cursor is captured before the background job emits startup events
// COMPLEXITY: O(1)
export const startTerminalSession = (
  projectId: string,
  requestId: string
) =>
  Effect.gen(function*(_) {
    const cursor = latestProjectCursor(projectId)
    yield* _(
      createTerminalSession(projectId, { requestId }).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            emitTerminalSessionFailure(
              projectId,
              requestId,
              error instanceof Error ? error.message : describeUnknown(error)
            ),
          onSuccess: () => Effect.void
        }),
        Effect.forkDaemon
      )
    )
    return {
      accepted: true,
      cursor,
      projectId,
      requestId
    }
  })

export const deleteTerminalSession = (
  projectId: string,
  sessionId: string
): Effect.Effect<void, ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const record = records.get(sessionId)
    const deleted = deleteDurableSession(projectId, sessionId)
    if ((record === undefined || record.projectId !== projectId) && !deleted) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
      )
    }
    if (record !== undefined && record.projectId === projectId) {
      cleanupRecord(record)
    }
    yield* _(
      Effect.sync(() => {
        emitProjectEvent(projectId, "project.ssh.session", {
          phase: "closed",
          sessionId
        })
      })
    )
  })

export const listProjectTerminalSessions = (projectId: string): ReadonlyArray<TerminalSession> =>
  readTerminalSessionFile(projectId).sessions.map((durable) => {
    const record = records.get(durable.id)
    if (record !== undefined && record.projectId === projectId) {
      syncAttachedClientCount(record)
      return record.session
    }
    return terminalSessionFromDurable(durable, 0)
  })

export const getProjectTerminalSession = (
  projectId: string,
  sessionId: string
): Effect.Effect<TerminalSession, ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const record = records.get(sessionId)
    if (record !== undefined && record.projectId === projectId) {
      syncAttachedClientCount(record)
      return record.session
    }
    const durable = findDurableSession(projectId, sessionId)
    if (durable === null) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
      )
    }
    return terminalSessionFromDurable(durable, 0)
  })

export const readProjectTerminalImage = (
  projectId: string,
  sessionId: string,
  imagePath: string
): Effect.Effect<
  { readonly bytes: Buffer; readonly mediaType: string },
  ApiBadRequestError | ApiInternalError | ApiNotFoundError
> =>
  Effect.gen(function*(_) {
    const record = records.get(sessionId)
    if (record === undefined || record.projectId !== projectId) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
      )
    }
    const plan = planTerminalImageFetch(imagePath, { baseDir: record.projectTargetDir })
    if (plan._tag === "InvalidTerminalImageFetch") {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: plan.message })))
    }
    const bytes = yield* _(readBufferFromProjectContainer(
      record.projectContainerName,
      plan.containerPath,
      terminalImageFetchMaxBytes
    ))
    return { bytes, mediaType: plan.mediaType }
  })

export const lookupTerminalSessionById = (
  sessionId: string
): Effect.Effect<
  { readonly projectDisplayName: string; readonly projectKey: string; readonly session: TerminalSession },
  ApiNotFoundError,
  TerminalSessionRuntime
> =>
  Effect.gen(function*(_) {
    const record = records.get(sessionId)
    if (record !== undefined) {
      syncAttachedClientCount(record)
      return {
        projectDisplayName: record.projectDisplayName,
        projectKey: record.projectKey,
        session: record.session
      }
    }
    const projects = yield* _(listProjectItems)
    for (const project of projects) {
      const durable = findDurableSession(project.projectDir, sessionId)
      if (durable !== null) {
        return {
          projectDisplayName: durable.projectDisplayName,
          projectKey: durable.projectKey,
          session: terminalSessionFromDurable(durable, 0)
        }
      }
    }
    return yield* _(
      Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
    )
  }).pipe(
    Effect.catchAll((error) => {
      if (error instanceof ApiNotFoundError) {
        return Effect.fail(error)
      }
      return Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
    })
  )

const handleCloseMessage = (record: TerminalRecord): void => {
  deleteDurableSession(record.projectId, record.session.id)
  cleanupRecord(record)
}

const detachSocketFromRecord = (
  record: TerminalRecord,
  socket: WebSocket
): void => {
  const current = records.get(record.session.id)
  if (current === undefined) {
    return
  }
  if (!current.sockets.delete(socket)) {
    return
  }
  syncAttachedClientCount(current)
  clearDetachTimeout(current)
  if (attachedClientCount(current) === 0) {
    detachRecordPty(current)
  }
}

const handleSocketMessage = (record: TerminalRecord, socket: WebSocket, raw: RawData): void => {
  const message = decodeClientMessage(raw)
  if (message === null) {
    sendServerMessage(socket, { type: "error", message: "Invalid terminal payload." })
    return
  }
  if (message.type === "input") {
    writePtyInput(record.pty, message.data)
    return
  }
  if (message.type === "resize") {
    resizePty(record.pty, clampTerminalSize(message.cols, 120), clampTerminalSize(message.rows, 32))
    return
  }
  if (message.type === "image") {
    handleImagePasteMessage(record, message)
    return
  }
  handleCloseMessage(record)
}

const attachSocketToRecord = (
  record: TerminalRecord,
  socket: WebSocket,
  cols: number,
  rows: number
): void => {
  clearAttachTimeout(record)
  clearDetachTimeout(record)
  record.sockets.add(socket)
  attachWebSocketHeartbeat(socket)
  startTerminalPty(record, cols, rows)
  syncAttachedClientCount(record)
  sendServerMessage(socket, { type: "ready", session: record.session })
  replayTerminalOutput(record, socket)
  socket.on("message", (raw: RawData) => {
    handleSocketMessage(record, socket, raw)
  })
  socket.on("close", () => {
    detachSocketFromRecord(record, socket)
  })
}

type ParsedTerminalPath =
  | { readonly cols: number; readonly kind: "projectId"; readonly projectId: string; readonly rows: number; readonly sessionId: string }
  | { readonly cols: number; readonly kind: "projectKey"; readonly projectKey: string; readonly rows: number; readonly sessionId: string }

const parseTerminalPath = (
  request: IncomingMessage
): ParsedTerminalPath | null => {
  const url = request.url
  if (url === undefined) {
    return null
  }
  const parsed = new URL(url, "http://localhost")
  const keyMatch = terminalWsByKeyPathPattern.exec(parsed.pathname)
  if (keyMatch !== null) {
    return {
      cols: clampTerminalSize(Number(parsed.searchParams.get("cols") ?? ""), 120),
      kind: "projectKey",
      projectKey: decodeURIComponent(keyMatch[1] ?? ""),
      rows: clampTerminalSize(Number(parsed.searchParams.get("rows") ?? ""), 32),
      sessionId: decodeURIComponent(keyMatch[2] ?? "")
    }
  }
  const idMatch = terminalWsPathPattern.exec(parsed.pathname)
  if (idMatch === null) {
    return null
  }
  return {
    cols: clampTerminalSize(Number(parsed.searchParams.get("cols") ?? ""), 120),
    kind: "projectId",
    projectId: decodeURIComponent(idMatch[1] ?? ""),
    rows: clampTerminalSize(Number(parsed.searchParams.get("rows") ?? ""), 32),
    sessionId: decodeURIComponent(idMatch[2] ?? "")
  }
}

const denyUpgrade = (socket: Duplex): void => {
  socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
  socket.destroy()
}

const resolveParsedTerminalRecord = (
  parsed: ParsedTerminalPath
): Effect.Effect<TerminalRecord, ApiConflictError | ApiInternalError | ApiNotFoundError, TerminalSessionRuntime> =>
  parsed.kind === "projectId"
    ? hydrateTerminalRecordByProjectId(parsed.projectId, parsed.sessionId)
    : hydrateTerminalRecordByProjectKey(parsed.projectKey, parsed.sessionId)

export const attachTerminalWebSocketServer = (server: HttpServer): void => {
  const webSocketServer = new WebSocketServer({ noServer: true })
  server.on("upgrade", (request, socket, head) => {
    const parsed = parseTerminalPath(request)
    if (parsed === null) {
      return
    }
    void Effect.runPromise(
      resolveParsedTerminalRecord(parsed).pipe(
        Effect.provide(NodeContext.layer),
        Effect.match({
          onFailure: () => {
            denyUpgrade(socket)
          },
          onSuccess: (record) => {
            webSocketServer.handleUpgrade(request, socket, head, (webSocket: WebSocket) => {
              try {
                attachSocketToRecord(record, webSocket, parsed.cols, parsed.rows)
              } catch (error) {
                sendServerMessage(webSocket, { type: "error", message: describeUnknown(error) })
                webSocket.close()
              }
            })
          }
        })
      )
    )
  })
}

export const verifyTerminalSession = (
  projectId: string,
  sessionId: string
): Effect.Effect<TerminalSession, ApiNotFoundError> =>
  getProjectTerminalSession(projectId, sessionId)
