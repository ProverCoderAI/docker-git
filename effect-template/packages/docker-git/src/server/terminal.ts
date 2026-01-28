import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { Effect } from "effect"
import * as Layer from "effect/Layer"
import * as Runtime from "effect/Runtime"
import * as Scope from "effect/Scope"
import { NodeContext } from "@effect/platform-node"
import type { PlatformError } from "@effect/platform/Error"
import type { IncomingMessage } from "node:http"
import { WebSocketServer } from "ws"
import type { RawData, WebSocket } from "ws"
import * as Pty from "node-pty"

import type { ConfigDecodeError, ConfigNotFoundError } from "../shell/errors.js"
import { ProjectNotFoundError } from "./errors.js"
import { loadProject } from "./projects.js"
import { resolveWritableCodexRoot } from "./codex.js"
import type { ProjectSummary } from "./core/domain.js"
import { ProjectIdPattern } from "./core/schema.js"
import { CodexAuthError, prepareCodexAccountDir } from "./codex.js"

type TerminalError =
  | ProjectNotFoundError
  | ConfigNotFoundError
  | ConfigDecodeError
  | CodexAuthError
  | PlatformError

interface TerminalBase {
  readonly cols: number
  readonly rows: number
}

interface TerminalProjectTarget extends TerminalBase {
  readonly type: "ssh"
  readonly projectId: string
}

interface TerminalCodexTarget extends TerminalBase {
  readonly type: "codex"
  readonly label: string
}

type TerminalTarget = TerminalProjectTarget | TerminalCodexTarget

interface ClientInputMessage {
  readonly type: "input"
  readonly data: string
}

interface ClientResizeMessage {
  readonly type: "resize"
  readonly cols: number
  readonly rows: number
}

type ClientMessage = ClientInputMessage | ClientResizeMessage

interface ServerMessage {
  readonly type: "output" | "error"
  readonly data?: string
  readonly message?: string
}

const decodePayload = (data: RawData): string => {
  if (typeof data === "string") {
    return data
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf-8")
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf-8")
  }

  return Buffer.concat(data).toString("utf-8")
}

const decodeClientMessage = (data: RawData): ClientMessage | null => {
  const payload = decodePayload(data)

  try {
    const parsed = JSON.parse(payload)
    if (parsed && parsed.type === "input" && typeof parsed.data === "string") {
      return { type: "input", data: parsed.data }
    }
    if (
      parsed &&
      parsed.type === "resize" &&
      Number.isFinite(parsed.cols) &&
      Number.isFinite(parsed.rows)
    ) {
      return { type: "resize", cols: Number(parsed.cols), rows: Number(parsed.rows) }
    }
  } catch {
    return { type: "input", data: payload }
  }

  return null
}

const sendMessage = (socket: WebSocket, message: ServerMessage) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

const parseTerminalTarget = (url: string | undefined): TerminalTarget | null => {
  if (!url) {
    return null
  }

  const parsed = new URL(url, "http://localhost")
  const colsRaw = parsed.searchParams.get("cols")
  const rowsRaw = parsed.searchParams.get("rows")
  const cols = colsRaw ? Number(colsRaw) : 120
  const rows = rowsRaw ? Number(rowsRaw) : 30
  const base: TerminalBase = {
    cols: Number.isFinite(cols) && cols > 0 ? cols : 120,
    rows: Number.isFinite(rows) && rows > 0 ? rows : 30
  }

  const termMatch = /^\/term\/([^/]+)\/?$/.exec(parsed.pathname)
  if (termMatch && termMatch[1]) {
    const projectId = decodeURIComponent(termMatch[1])
    if (!ProjectIdPattern.test(projectId)) {
      return null
    }
    return { type: "ssh", projectId, ...base }
  }

  const codexMatch = /^\/codex\/([^/]+)\/?$/.exec(parsed.pathname)
  if (codexMatch && codexMatch[1]) {
    return { type: "codex", label: decodeURIComponent(codexMatch[1]), ...base }
  }

  return null
}

const buildSshArgs = (project: ProjectSummary): Array<string> => {
  const args: Array<string> = [
    "-tt",
    "-p",
    String(project.sshPort),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes"
  ]

  if (project.sshKeyPath) {
    args.push("-i", project.sshKeyPath)
  }

  args.push(`${project.sshUser}@${project.sshHost}`)

  return args
}

const startTerminalSession = (
  socket: WebSocket,
  target: TerminalProjectTarget,
  project: ProjectSummary
) => {
  const home = process.env["HOME"]
  const baseOptions = {
    name: "xterm-256color",
    cols: target.cols,
    rows: target.rows
  }
  const options = home && home.length > 0 ? { ...baseOptions, cwd: home } : baseOptions

  const term = Pty.spawn("ssh", buildSshArgs(project), options)
  let closed = false

  const safeWrite = (data: string) => {
    if (closed) {
      return
    }
    try {
      term.write(data)
    } catch (error) {
      closed = true
      sendMessage(socket, {
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const safeResize = (cols: number, rows: number) => {
    if (closed) {
      return
    }
    try {
      term.resize(cols, rows)
    } catch (error) {
      closed = true
      sendMessage(socket, {
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  term.onData((data) => {
    sendMessage(socket, { type: "output", data })
  })

  term.onExit(() => {
    closed = true
    sendMessage(socket, { type: "output", data: "\r\n[session closed]\r\n" })
    socket.close()
  })

  socket.on("message", (raw: RawData) => {
    const message = decodeClientMessage(raw)
    if (!message) {
      return
    }

    if (message.type === "input") {
      safeWrite(message.data)
    } else {
      safeResize(message.cols, message.rows)
    }
  })

  socket.on("close", () => {
    term.kill()
  })

  socket.on("error", () => {
    term.kill()
  })
}

const startCodexSession = (
  socket: WebSocket,
  target: TerminalCodexTarget,
  codexHome: string
) => {
  const home = process.env["HOME"]
  const baseOptions = {
    name: "xterm-256color",
    cols: target.cols,
    rows: target.rows,
    env: { ...process.env, CODEX_HOME: codexHome }
  }
  const options = home && home.length > 0 ? { ...baseOptions, cwd: home } : baseOptions

  const term = Pty.spawn("codex", ["login"], options)
  let closed = false

  const safeWrite = (data: string) => {
    if (closed) {
      return
    }
    try {
      term.write(data)
    } catch (error) {
      closed = true
      sendMessage(socket, {
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const safeResize = (cols: number, rows: number) => {
    if (closed) {
      return
    }
    try {
      term.resize(cols, rows)
    } catch (error) {
      closed = true
      sendMessage(socket, {
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  term.onData((data) => {
    sendMessage(socket, { type: "output", data })
  })

  term.onExit(() => {
    closed = true
    sendMessage(socket, { type: "output", data: "\r\n[session closed]\r\n" })
    socket.close()
  })

  socket.on("message", (raw: RawData) => {
    const message = decodeClientMessage(raw)
    if (!message) {
      return
    }

    if (message.type === "input") {
      safeWrite(message.data)
    } else {
      safeResize(message.cols, message.rows)
    }
  })

  socket.on("close", () => {
    term.kill()
  })

  socket.on("error", () => {
    term.kill()
  })
}

const handleTerminalExit = (
  socket: WebSocket,
  exit: Exit.Exit<ProjectSummary, TerminalError>,
  target: TerminalProjectTarget
) =>
  Exit.match(exit, {
    onFailure: (cause) => {
      const message = Cause.pretty(cause)
      sendMessage(socket, { type: "error", message })
      socket.close()
    },
    onSuccess: (project) => {
      startTerminalSession(socket, target, project)
    }
  })

const handleCodexExit = (
  socket: WebSocket,
  exit: Exit.Exit<string, TerminalError>,
  target: TerminalCodexTarget
) =>
  Exit.match(exit, {
    onFailure: (cause) => {
      const message = Cause.pretty(cause)
      sendMessage(socket, { type: "error", message })
      socket.close()
    },
    onSuccess: (codexHome) => {
      startCodexSession(socket, target, codexHome)
    }
  })

// CHANGE: attach a WebSocket terminal bridge on a dedicated port
// WHY: allow in-browser SSH sessions without conflicting with the HTTP server upgrade handler
// QUOTE(ТЗ): "Сделай что бы я сразу от сюда мог подключаться к терминалу"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall ws: connect(ws) -> ssh_session(ws) | error(ws)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, Scope>
// INVARIANT: terminal sessions are closed when websocket closes
// COMPLEXITY: O(1) per connection
export const attachTerminalBridge = (
  terminalPort: number,
  projectsRoot: string,
  cwd: string
): Effect.Effect<void, PlatformError, Scope.Scope> =>
  Layer.toRuntime(NodeContext.layer).pipe(
    Effect.flatMap((runtime) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const wss = new WebSocketServer({ port: terminalPort })

          const handleConnection = (ws: WebSocket, request: IncomingMessage) => {
            const target = parseTerminalTarget(request.url)
            if (!target) {
              sendMessage(ws, { type: "error", message: "Invalid terminal target" })
              ws.close()
              return
            }

            if (target.type === "ssh") {
              Runtime.runCallback(runtime, loadProject(projectsRoot, target.projectId, cwd), {
                onExit: (exit) => handleTerminalExit(ws, exit, target)
              })
              return
            }

            Runtime.runCallback(
              runtime,
              Effect.gen(function* (_) {
                const codexRootPath = yield* _(resolveWritableCodexRoot(projectsRoot))
                return yield* _(prepareCodexAccountDir(codexRootPath, target.label))
              }),
              {
                onExit: (exit) => handleCodexExit(ws, exit, target)
              }
            )
          }

          wss.on("connection", handleConnection)

          return { wss, handleConnection }
        }),
        ({ wss, handleConnection }) =>
          Effect.sync(() => {
            wss.off("connection", handleConnection)
            wss.close()
          })
      ).pipe(Effect.asVoid)
    )
  )
