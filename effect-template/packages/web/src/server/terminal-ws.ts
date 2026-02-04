import { Effect } from "effect"
import type { WebSocket, WebSocketServer } from "ws"
import { Client } from "ssh2"
import fs from "node:fs"
import { randomUUID } from "node:crypto"

import { getProjectDetails, upProject } from "./docker-git"
import { runEffect } from "./runtime"

type TerminalMessage =
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "error"; readonly data: string }
  | { readonly type: "info"; readonly data: string }

type TerminalCommand =
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }

type TerminalSessionMode = "default" | "recreate"
type TerminalSessionStatus = "connecting" | "connected"

type TerminalSessionRegistry = {
  readonly id: string
  readonly projectId: string
  readonly displayName: string
  readonly mode: TerminalSessionMode
  readonly source: string
  readonly status: TerminalSessionStatus
  readonly connectedAt: string
  readonly updatedAt: string
}

type SshTarget = {
  readonly username: string
  readonly host: string
  readonly port: number
  readonly identityPath: string
}

const sessionsFile = "/tmp/docker-git-terminal-sessions.json"
const sessions = new Map<string, TerminalSessionRegistry>()

const nowIso = () => new Date().toISOString()

// CHANGE: persist active terminal sessions for discovery
// WHY: expose running terminals to the web UI and agents
// QUOTE(ТЗ): "мы можем получать список всех запущенных терминалов?"
// REF: user-request-2026-02-04-terminal-sessions
// SOURCE: n/a
// FORMAT THEOREM: ∀s ∈ sessions: stored(s) → visible(s)
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: session.id уникален в registry
// COMPLEXITY: O(n)
const writeSessions = () => {
  try {
    const payload = {
      updatedAt: nowIso(),
      sessions: Array.from(sessions.values())
    }
    fs.writeFileSync(sessionsFile, JSON.stringify(payload, null, 2))
  } catch {
    // Ignore registry persistence failures.
  }
}

writeSessions()

const registerSession = (session: TerminalSessionRegistry) => {
  sessions.set(session.id, { ...session, updatedAt: nowIso() })
  writeSessions()
}

const updateSession = (sessionId: string, patch: Partial<TerminalSessionRegistry>) => {
  const current = sessions.get(sessionId)
  if (!current) {
    return
  }
  sessions.set(sessionId, { ...current, ...patch, updatedAt: nowIso() })
  writeSessions()
}

const removeSession = (sessionId: string) => {
  if (!sessions.has(sessionId)) {
    return
  }
  sessions.delete(sessionId)
  writeSessions()
}

const nextSessionId = (): string => {
  try {
    return randomUUID()
  } catch {
    return `term-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

const sendMessage = (socket: WebSocket, payload: TerminalMessage) => {
  if (socket.readyState !== socket.OPEN) {
    return
  }
  socket.send(JSON.stringify(payload))
}

const decodeMessage = (raw: string): TerminalCommand | null => {
  try {
    const parsed = JSON.parse(raw) as TerminalCommand
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return parsed
    }
    if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

const parseSshTarget = (ssh: string, sshCommand: string): SshTarget => {
  const userHostPort = /^(?<user>[^@]+)@(?<host>[^:]+):(?<port>\d+)$/u.exec(ssh)
  if (!userHostPort?.groups) {
    throw new Error(`Invalid ssh descriptor: ${ssh}`)
  }

  const identityMatch = /-i\s+(?<path>\S+)/u.exec(sshCommand)
  if (!identityMatch?.groups?.path) {
    throw new Error(`Identity key not found in ssh command: ${sshCommand}`)
  }

  return {
    username: userHostPort.groups.user,
    host: userHostPort.groups.host,
    port: Number(userHostPort.groups.port),
    identityPath: identityMatch.groups.path
  }
}

const startSshSession = (projectId: string) =>
  runEffect(
    Effect.gen(function*(_) {
      yield* _(upProject(projectId))
      const details = yield* _(getProjectDetails(projectId))
      const target = parseSshTarget(details.ssh, details.sshCommand)
      return { details, target }
    })
  )

export const attachTerminalWs = (wss: WebSocketServer) => {
  wss.on("connection", (socket, request) => {
    const requestUrl = request.url ?? ""
    const url = new URL(requestUrl, "http://localhost")
    const projectId = url.searchParams.get("projectId")
    const sessionId = url.searchParams.get("sessionId") ?? nextSessionId()
    const source = url.searchParams.get("source") ?? "web"
    const mode = url.searchParams.get("mode") === "recreate" ? "recreate" : "default"

    if (!projectId) {
      sendMessage(socket, { type: "error", data: "projectId is required" })
      socket.close()
      return
    }

    registerSession({
      id: sessionId,
      projectId,
      displayName: projectId,
      mode,
      source,
      status: "connecting",
      connectedAt: nowIso(),
      updatedAt: nowIso()
    })

    sendMessage(socket, { type: "info", data: "[docker-git] connecting terminal…" })

    startSshSession(projectId)
      .then(({ details, target }) => {
        const client = new Client()
        const privateKey = fs.readFileSync(target.identityPath)

        client.on("ready", () => {
          updateSession(sessionId, { status: "connected", displayName: details.displayName })
          sendMessage(socket, { type: "info", data: `[docker-git] attached to ${details.displayName}` })

          client.shell(
            {
              term: "xterm-256color",
              cols: 120,
              rows: 32
            },
            (error, stream) => {
              if (error) {
                sendMessage(socket, { type: "error", data: String(error) })
                socket.close()
                client.end()
                return
              }

              stream.on("data", (data: Buffer) => {
                sendMessage(socket, { type: "output", data: data.toString("utf-8") })
              })

              stream.stderr.on("data", (data: Buffer) => {
                sendMessage(socket, { type: "output", data: data.toString("utf-8") })
              })

              socket.on("message", (payload) => {
                const raw = typeof payload === "string" ? payload : payload.toString("utf-8")
                const command = decodeMessage(raw)
                if (!command) {
                  return
                }
                if (command.type === "input") {
                  stream.write(command.data)
                }
                if (command.type === "resize") {
                  stream.setWindow(command.rows, command.cols, 0, 0)
                }
              })

              socket.on("close", () => {
                stream.close()
                client.end()
                removeSession(sessionId)
              })

              socket.on("error", () => {
                stream.close()
                client.end()
                removeSession(sessionId)
              })
            }
          )
        })

        client.on("error", (error) => {
          sendMessage(socket, { type: "error", data: String(error) })
          socket.close()
          removeSession(sessionId)
        })

        client.connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey,
          readyTimeout: 15000,
          hostHash: "sha256",
          hostVerifier: () => true
        })
      })
      .catch((error: unknown) => {
        sendMessage(socket, { type: "error", data: String(error) })
        socket.close()
        removeSession(sessionId)
      })
  })
}
