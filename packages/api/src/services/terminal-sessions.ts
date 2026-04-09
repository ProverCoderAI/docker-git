import { prepareProjectSsh, waitForProjectSshReady } from "@effect-template/lib"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"
import { randomUUID } from "node:crypto"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import { spawn, type IPty } from "node-pty"
import { WebSocket, WebSocketServer, type RawData } from "ws"

import type { TerminalSession, TerminalSessionStatus } from "../api/contracts.js"
import { ApiConflictError, ApiInternalError, ApiNotFoundError, describeUnknown } from "../api/errors.js"
import { emitProjectEvent } from "./events.js"
import { getProjectItemById, upProject } from "./projects.js"

type TerminalClientMessage =
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | { readonly type: "close" }

type TerminalServerMessage =
  | { readonly type: "ready"; readonly session: TerminalSession }
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "exit"; readonly exitCode: number | null; readonly signal: number | null }
  | { readonly type: "error"; readonly message: string }

type TerminalRecord = {
  session: TerminalSession
  pty: IPty | null
  socket: WebSocket | null
  attachTimeout: ReturnType<typeof setTimeout> | null
  projectId: string
  prepared: ReturnType<typeof prepareProjectSsh>
}

const records = new Map<string, TerminalRecord>()
const attachTimeoutMs = 30_000
const terminalWsPathPattern = /^(?:\/api)?\/projects\/([^/]+)\/terminal-sessions\/([^/]+)\/ws$/u

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
      type: Schema.Literal("close")
    })
  )
)

const nowIso = (): string => new Date().toISOString()

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

const toApiInternalError = (error: unknown): ApiInternalError =>
  error instanceof ApiInternalError
    ? error
    : new ApiInternalError({
      message: describeUnknown(error),
      cause: error
    })

const encodeServerMessage = (message: TerminalServerMessage): string => JSON.stringify(message)

const sendServerMessage = (socket: WebSocket | null, message: TerminalServerMessage): void => {
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(encodeServerMessage(message))
}

const clearAttachTimeout = (record: TerminalRecord): void => {
  if (record.attachTimeout !== null) {
    clearTimeout(record.attachTimeout)
    record.attachTimeout = null
  }
}

const closeSocket = (socket: WebSocket | null): void => {
  if (socket === null || socket.readyState === WebSocket.CLOSED) {
    return
  }
  socket.close()
}

const cleanupRecord = (record: TerminalRecord): void => {
  clearAttachTimeout(record)
  if (record.pty !== null) {
    record.pty.kill()
    record.pty = null
  }
  closeSocket(record.socket)
  record.socket = null
  records.delete(record.session.id)
}

const finalizeRecord = (
  record: TerminalRecord,
  status: Extract<TerminalSessionStatus, "exited" | "failed">,
  exitCode: number | null,
  signal: number | null
): void => {
  updateSession(record, {
    closedAt: nowIso(),
    exitCode: exitCode ?? undefined,
    signal: signal ?? undefined,
    status
  })
  sendServerMessage(record.socket, { type: "exit", exitCode, signal })
  closeSocket(record.socket)
  record.socket = null
  record.pty = null
  clearAttachTimeout(record)
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

const startTerminalPty = (
  record: TerminalRecord,
  cols: number,
  rows: number
): void => {
  const resolvedCols = clampTerminalSize(cols, 120)
  const resolvedRows = clampTerminalSize(rows, 32)
  const pty = spawn(record.prepared.command, [...record.prepared.args], {
    cols: resolvedCols,
    cwd: record.prepared.cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color"
    },
    name: "xterm-256color",
    rows: resolvedRows
  })
  record.pty = pty
  updateSession(record, {
    startedAt: nowIso(),
    status: "attached"
  })
  pty.onData((data) => {
    sendServerMessage(record.socket, { type: "output", data })
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
  prepared: ReturnType<typeof prepareProjectSsh>
): TerminalSession => {
  const session: TerminalSession = {
    createdAt: nowIso(),
    id: randomUUID(),
    projectId,
    sshCommand: prepared.item.sshCommand,
    status: "ready"
  }
  const record: TerminalRecord = {
    attachTimeout: null,
    prepared,
    projectId,
    pty: null,
    session,
    socket: null
  }
  record.attachTimeout = createAttachTimeout(session.id)
  records.set(session.id, record)
  return session
}

export const createTerminalSession = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(upProject(projectId, undefined, true))
    const projectItem = yield* _(getProjectItemById(projectId))
    yield* _(waitForProjectSshReady(projectItem).pipe(Effect.mapError(toApiInternalError)))
    const prepared = prepareProjectSsh(projectItem)
    const session = registerRecord(projectId, prepared)
    yield* _(
      Effect.sync(() => {
        emitProjectEvent(projectId, "project.ssh.session", {
          phase: "created",
          sessionId: session.id
        })
      })
    )
    return { project, session }
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

const handleCloseMessage = (record: TerminalRecord): void => {
  cleanupRecord(record)
}

const handleSocketMessage = (record: TerminalRecord, raw: RawData): void => {
  const message = decodeClientMessage(raw)
  if (message === null) {
    sendServerMessage(record.socket, { type: "error", message: "Invalid terminal payload." })
    return
  }
  if (message.type === "input") {
    record.pty?.write(message.data)
    return
  }
  if (message.type === "resize") {
    record.pty?.resize(clampTerminalSize(message.cols, 120), clampTerminalSize(message.rows, 32))
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
  if (record.socket !== null) {
    throw new ApiConflictError({ message: `Terminal session already attached: ${record.session.id}` })
  }

  clearAttachTimeout(record)
  record.socket = socket
  startTerminalPty(record, cols, rows)
  sendServerMessage(socket, { type: "ready", session: record.session })
  socket.on("message", (raw: RawData) => {
    handleSocketMessage(record, raw)
  })
  socket.on("close", () => {
    const current = records.get(record.session.id)
    if (current !== undefined) {
      cleanupRecord(current)
    }
  })
}

const parseTerminalPath = (
  request: IncomingMessage
): { readonly cols: number; readonly projectId: string; readonly rows: number; readonly sessionId: string } | null => {
  const url = request.url
  if (url === undefined) {
    return null
  }
  const parsed = new URL(url, "http://localhost")
  const match = terminalWsPathPattern.exec(parsed.pathname)
  if (match === null) {
    return null
  }
  return {
    cols: clampTerminalSize(Number(parsed.searchParams.get("cols") ?? ""), 120),
    projectId: decodeURIComponent(match[1] ?? ""),
    rows: clampTerminalSize(Number(parsed.searchParams.get("rows") ?? ""), 32),
    sessionId: decodeURIComponent(match[2] ?? "")
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
    if (record === undefined || record.projectId !== parsed.projectId) {
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
    return record.session
  })
