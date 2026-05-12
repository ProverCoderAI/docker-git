import { type AppError, prepareProjectSsh, probeProjectSshReady, renderError, waitForProjectSshReady } from "@effect-template/lib"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { parseInspectNetworkEntry } from "@effect-template/lib/shell/docker-inspect-parse"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import * as FileSystem from "@effect/platform/FileSystem"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import os from "node:os"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer, type RawData } from "ws"

import type { TerminalSession, TerminalSessionStatus } from "../api/contracts.js"
import { ApiBadRequestError, ApiInternalError, ApiNotFoundError, describeUnknown } from "../api/errors.js"
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
import { getProject, getProjectItemById, upProject } from "./projects.js"
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

const records = new Map<string, TerminalRecord>()
const attachTimeoutMs = 30_000
const terminalWsPathPattern = /^(?:\/api)?\/projects\/([^/]+)\/terminal-sessions\/([^/]+)\/ws$/u
const terminalWsByKeyPathPattern = /^(?:\/api)?\/projects\/by-key\/([^/]+)\/terminal-sessions\/([^/]+)\/ws$/u

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

const nowIso = (): string => new Date().toISOString()

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
    record.pty.kill()
    record.pty = null
  }
  closeRecordSockets(record)
  records.delete(record.session.id)
}

const finalizeRecord = (
  record: TerminalRecord,
  status: Extract<TerminalSessionStatus, "exited" | "failed">,
  exitCode: number | null,
  signal: number | null
): void => {
  updateSession(record, {
    attachedClients: attachedClientCount(record),
    closedAt: nowIso(),
    exitCode: exitCode ?? undefined,
    signal: signal ?? undefined,
    status
  })
  broadcastServerMessage(record, { type: "exit", exitCode, signal })
  closeRecordSockets(record)
  record.pty = null
  clearAttachTimeout(record)
  clearDetachTimeout(record)
  records.delete(record.session.id)
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
  const pty = spawnPtyBridge({
    args: record.prepared.args,
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
    finalizeRecord(
      record,
      exitCode === 0 || exitCode === 130 ? "exited" : "failed",
      exitCode ?? null,
      signal ?? null
    )
  })
}

const createAttachTimeout = (sessionId: string): ReturnType<typeof setTimeout> =>
  setTimeout(() => {
    const record = records.get(sessionId)
    if (record !== undefined) {
      cleanupRecord(record)
    }
  }, attachTimeoutMs)

const registerRecord = (
  projectId: string,
  projectKey: string,
  projectDisplayName: string,
  prepared: ReturnType<typeof prepareProjectSsh>,
  projectContainerName: string,
  projectTargetDir: string
): TerminalSession => {
  const session: TerminalSession = {
    attachedClients: 0,
    createdAt: nowIso(),
    id: randomUUID(),
    projectId,
    sshCommand: renderPreparedSshCommand(prepared),
    status: "ready"
  }
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
  record.attachTimeout = createAttachTimeout(session.id)
  records.set(session.id, record)
  return session
}

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
        projectItem.targetDir
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
      reachableProjectItem.targetDir
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
    if (record === undefined || record.projectId !== projectId) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
      )
    }
    cleanupRecord(record)
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
  [...records.values()]
    .filter((record) => record.projectId === projectId)
    .map((record) => {
      syncAttachedClientCount(record)
      return record.session
    })

export const getProjectTerminalSession = (
  projectId: string,
  sessionId: string
): Effect.Effect<TerminalSession, ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const record = records.get(sessionId)
    if (record === undefined || record.projectId !== projectId) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
      )
    }
    syncAttachedClientCount(record)
    return record.session
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
  ApiNotFoundError
> =>
  Effect.gen(function*(_) {
    const record = records.get(sessionId)
    if (record === undefined) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
      )
    }
    syncAttachedClientCount(record)
    return {
      projectDisplayName: record.projectDisplayName,
      projectKey: record.projectKey,
      session: record.session
    }
  })

const handleCloseMessage = (record: TerminalRecord): void => {
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
  current.sockets.delete(socket)
  syncAttachedClientCount(current)
  clearDetachTimeout(current)
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

export const attachTerminalWebSocketServer = (server: HttpServer): void => {
  const webSocketServer = new WebSocketServer({ noServer: true })
  server.on("upgrade", (request, socket, head) => {
    const parsed = parseTerminalPath(request)
    if (parsed === null) {
      return
    }
    const record = records.get(parsed.sessionId)
    const matchesProject = record !== undefined && (
      parsed.kind === "projectId"
        ? record.projectId === parsed.projectId
        : record.projectKey === parsed.projectKey
    )
    if (!matchesProject || record === undefined) {
      denyUpgrade(socket)
      return
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket: WebSocket) => {
      try {
        attachSocketToRecord(record, webSocket, parsed.cols, parsed.rows)
      } catch (error) {
        sendServerMessage(webSocket, { type: "error", message: describeUnknown(error) })
        webSocket.close()
      }
    })
  })
}

export const verifyTerminalSession = (
  projectId: string,
  sessionId: string
): Effect.Effect<TerminalSession, ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const record = records.get(sessionId)
    if (record === undefined || record.projectId !== projectId) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Terminal session not found: ${sessionId}` }))
      )
    }
    syncAttachedClientCount(record)
    return record.session
  })
