import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Either, Effect } from "effect"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import { spawn, type IPty } from "node-pty"
import { WebSocket, WebSocketServer, type RawData } from "ws"

import type { AuthTerminalFlow, AuthTerminalSessionRequest, TerminalSession, TerminalSessionStatus } from "../api/contracts.js"
import { ApiConflictError, ApiNotFoundError, describeUnknown } from "../api/errors.js"

type TerminalClientMessage =
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | { readonly type: "close" }

type TerminalServerMessage =
  | { readonly type: "ready"; readonly session: TerminalSession }
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "exit"; readonly exitCode: number | null; readonly signal: number | null }
  | { readonly type: "error"; readonly message: string }

type AuthTerminalRecord = {
  attachTimeout: ReturnType<typeof setTimeout> | null
  args: ReadonlyArray<string>
  cwd: string
  pty: IPty | null
  session: TerminalSession
  socket: WebSocket | null
}

const attachTimeoutMs = 30_000
const authTerminalProjectId = "__controller__"
const authTerminalWsPathPattern = /^(?:\/api)?\/auth\/terminal-sessions\/([^/]+)\/ws$/u
const authRunnerPath = fileURLToPath(new URL("../auth-terminal-runner.js", import.meta.url))
const records = new Map<string, AuthTerminalRecord>()

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

const resolveCommandLabel = (request: AuthTerminalSessionRequest): string => {
  const label = request.label?.trim()
  const suffix = label === undefined || label.length === 0 ? "" : ` [${label}]`
  return request.flow === "ClaudeOauth"
    ? `docker-git menu auth claude oauth${suffix}`
    : `docker-git menu auth gemini oauth${suffix}`
}

const resolveRunnerArgs = (flow: AuthTerminalFlow, label: string | null | undefined): ReadonlyArray<string> => {
  const args = [authRunnerPath, flow]
  const normalizedLabel = label?.trim() ?? ""
  return normalizedLabel.length === 0 ? args : [...args, normalizedLabel]
}

const updateSession = (record: AuthTerminalRecord, patch: Partial<TerminalSession>): void => {
  record.session = {
    ...record.session,
    ...patch
  }
  records.set(record.session.id, record)
}

const encodeServerMessage = (message: TerminalServerMessage): string => JSON.stringify(message)

const sendServerMessage = (socket: WebSocket | null, message: TerminalServerMessage): void => {
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(encodeServerMessage(message))
}

const clearAttachTimeout = (record: AuthTerminalRecord): void => {
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

const cleanupRecord = (record: AuthTerminalRecord): void => {
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
  record: AuthTerminalRecord,
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

const writePtyInput = (pty: IPty | null, data: string): void => {
  if (pty === null) {
    return
  }
  try {
    pty.write(data)
  } catch {
    return
  }
}

const resizePty = (pty: IPty | null, cols: number, rows: number): void => {
  if (pty === null) {
    return
  }
  try {
    pty.resize(cols, rows)
  } catch {
    return
  }
}

const startTerminalPty = (record: AuthTerminalRecord, cols: number, rows: number): void => {
  const pty = spawn(process.execPath, [...record.args], {
    cols: clampTerminalSize(cols, 120),
    cwd: record.cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color"
    },
    name: "xterm-256color",
    rows: clampTerminalSize(rows, 32)
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

const registerRecord = (request: AuthTerminalSessionRequest): TerminalSession => {
  const session: TerminalSession = {
    createdAt: nowIso(),
    id: randomUUID(),
    projectId: authTerminalProjectId,
    sshCommand: resolveCommandLabel(request),
    status: "ready"
  }
  const record: AuthTerminalRecord = {
    args: resolveRunnerArgs(request.flow, request.label),
    attachTimeout: null,
    cwd: process.cwd(),
    pty: null,
    session,
    socket: null
  }
  record.attachTimeout = createAttachTimeout(session.id)
  records.set(session.id, record)
  return session
}

const handleSocketMessage = (record: AuthTerminalRecord, raw: RawData): void => {
  const message = decodeClientMessage(raw)
  if (message === null) {
    sendServerMessage(record.socket, { type: "error", message: "Invalid terminal payload." })
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
  cleanupRecord(record)
}

const attachSocketToRecord = (
  record: AuthTerminalRecord,
  socket: WebSocket,
  cols: number,
  rows: number
): void => {
  if (record.socket !== null) {
    throw new ApiConflictError({ message: `Auth terminal session already attached: ${record.session.id}` })
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
): { readonly cols: number; readonly rows: number; readonly sessionId: string } | null => {
  const url = request.url
  if (url === undefined) {
    return null
  }
  const parsed = new URL(url, "http://localhost")
  const match = authTerminalWsPathPattern.exec(parsed.pathname)
  if (match === null) {
    return null
  }
  return {
    cols: clampTerminalSize(Number(parsed.searchParams.get("cols") ?? ""), 120),
    rows: clampTerminalSize(Number(parsed.searchParams.get("rows") ?? ""), 32),
    sessionId: decodeURIComponent(match[1] ?? "")
  }
}

const denyUpgrade = (socket: Duplex): void => {
  socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
  socket.destroy()
}

export const createAuthTerminalSession = (
  request: AuthTerminalSessionRequest
): Effect.Effect<{ readonly session: TerminalSession }, never> =>
  Effect.succeed({ session: registerRecord(request) })

export const deleteAuthTerminalSession = (
  sessionId: string
): Effect.Effect<void, ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const record = records.get(sessionId)
    if (record === undefined) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Auth terminal session not found: ${sessionId}` }))
      )
    }
    cleanupRecord(record)
  })

export const attachAuthTerminalWebSocketServer = (server: HttpServer): void => {
  const webSocketServer = new WebSocketServer({ noServer: true })
  server.on("upgrade", (request, socket, head) => {
    const parsed = parseTerminalPath(request)
    if (parsed === null) {
      return
    }
    const record = records.get(parsed.sessionId)
    if (record === undefined) {
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
