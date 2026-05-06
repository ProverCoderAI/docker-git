import * as ParseResult from "@effect/schema/ParseResult"
import { Either } from "effect"

import { TerminalServerMessageSchema } from "../shared/terminal-session-schema.js"
import type { TerminalServerMessage as ParsedTerminalServerMessage } from "../shared/terminal-session-schema.js"
import { resolveApiBaseUrl, trimTrailingSlash } from "./api-http.js"
import type { TerminalSession } from "./api-schema.js"

type PendingTerminalConnection = {
  readonly message: string
  readonly phase: "connecting" | "error"
}

export type PendingActiveTerminalSession = ActiveTerminalSession & {
  readonly pendingConnection: PendingTerminalConnection
}

export type ActiveTerminalSession = {
  readonly browserProjectId?: string | undefined
  readonly browserProjectKey?: string | undefined
  readonly browserProjectName?: string | undefined
  readonly closePath: string
  readonly exitMessage: string
  readonly header: string
  readonly onExit?: () => void
  readonly onReady?: () => void
  readonly pendingConnection?: PendingTerminalConnection | undefined
  readonly pendingDeleteMessage: string
  readonly readyMessage: string
  readonly sessionPath?: string | undefined
  readonly session: TerminalSession
  readonly subtitle: string
  readonly websocketPath: string
}

type ProjectActiveTerminalSessionArgs = {
  readonly onExit?: () => void
  readonly onReady?: () => void
  readonly projectDisplayName: string
  readonly projectId: string
  readonly projectKey: string
  readonly session: TerminalSession
}

type PendingProjectActiveTerminalSessionArgs = {
  readonly createdAt?: string
  readonly onExit?: () => void
  readonly pendingSessionId: string
  readonly projectDisplayName: string
  readonly projectId: string
  readonly projectKey: string
  readonly phase?: PendingTerminalConnection["phase"]
  readonly message?: string
}

export const terminalSessionRoutePath = (sessionId: string): string => `/ssh/session/${encodeURIComponent(sessionId)}`

export const isPendingActiveTerminalSession = (
  session: ActiveTerminalSession
): session is PendingActiveTerminalSession => session.pendingConnection !== undefined

export const buildProjectActiveTerminalSession = (
  { onExit, onReady, projectDisplayName, projectId, projectKey, session }: ProjectActiveTerminalSessionArgs
): ActiveTerminalSession => {
  const encodedProjectKey = encodeURIComponent(projectKey)
  const encodedSessionId = encodeURIComponent(session.id)
  return {
    browserProjectId: projectId,
    browserProjectKey: projectKey,
    browserProjectName: projectDisplayName,
    closePath: `/projects/by-key/${encodedProjectKey}/terminal-sessions/${encodedSessionId}`,
    exitMessage: "SSH session ended.",
    header: `SSH terminal: ${projectDisplayName}`,
    ...(onExit === undefined ? {} : { onExit }),
    ...(onReady === undefined ? {} : { onReady }),
    pendingDeleteMessage: `Terminal session was closed before attach: ${projectDisplayName}.`,
    readyMessage: `SSH connected: ${projectDisplayName}.`,
    session,
    sessionPath: terminalSessionRoutePath(session.id),
    subtitle: session.sshCommand,
    websocketPath: `/projects/by-key/${encodedProjectKey}/terminal-sessions/${encodedSessionId}/ws`
  }
}

const resolvePendingProjectMessage = (
  message: string | undefined,
  phase: PendingTerminalConnection["phase"]
): string => {
  const trimmedMessage = message?.trim() ?? ""
  if (trimmedMessage.length > 0) {
    return trimmedMessage
  }
  return phase === "error"
    ? "SSH session startup failed."
    : "Starting project and waiting for SSH..."
}

export const buildPendingProjectActiveTerminalSession = (
  {
    createdAt,
    message,
    onExit,
    pendingSessionId,
    phase = "connecting",
    projectDisplayName,
    projectId,
    projectKey
  }: PendingProjectActiveTerminalSessionArgs
): ActiveTerminalSession => {
  const encodedProjectKey = encodeURIComponent(projectKey)
  const encodedSessionId = encodeURIComponent(pendingSessionId)
  const resolvedMessage = resolvePendingProjectMessage(message, phase)
  return {
    browserProjectId: projectId,
    browserProjectKey: projectKey,
    browserProjectName: projectDisplayName,
    closePath: `/projects/by-key/${encodedProjectKey}/terminal-sessions/${encodedSessionId}`,
    exitMessage: "Pending SSH session closed.",
    header: `SSH terminal: ${projectDisplayName}`,
    ...(onExit === undefined ? {} : { onExit }),
    pendingConnection: {
      message: resolvedMessage,
      phase
    },
    pendingDeleteMessage: `Pending SSH terminal was closed before attach: ${projectDisplayName}.`,
    readyMessage: `SSH connected: ${projectDisplayName}.`,
    session: {
      createdAt: createdAt ?? new Date().toISOString(),
      id: pendingSessionId,
      projectId,
      sshCommand: "Preparing SSH session...",
      status: phase === "error" ? "failed" : "ready"
    },
    sessionPath: terminalSessionRoutePath(pendingSessionId),
    subtitle: resolvedMessage,
    websocketPath: `/projects/by-key/${encodedProjectKey}/terminal-sessions/${encodedSessionId}/ws`
  }
}

export const resolveTerminalApiBaseUrl = (): string => {
  const configured = import.meta.env.VITE_DOCKER_GIT_TERMINAL_API_BASE_URL
  if (configured !== undefined && configured.trim().length > 0) {
    return trimTrailingSlash(configured.trim())
  }

  return resolveApiBaseUrl()
}

export const resolveTerminalApiOriginUrl = (): URL => {
  const configured = resolveTerminalApiBaseUrl()
  if (configured.startsWith("http://") || configured.startsWith("https://")) {
    return new URL(configured)
  }
  return new URL(configured, globalThis.location.origin)
}

export const resolveTerminalWebSocketUrl = (websocketPath: string, cols: number, rows: number): string => {
  const apiUrl = resolveTerminalApiOriginUrl()
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:"
  apiUrl.pathname = `${apiUrl.pathname.replace(/\/$/u, "")}${websocketPath}`
  apiUrl.searchParams.set("cols", String(cols))
  apiUrl.searchParams.set("rows", String(rows))
  return apiUrl.toString()
}

export const parseTerminalServerMessage = (value: string): ParsedTerminalServerMessage | null =>
  Either.getOrNull(ParseResult.decodeUnknownEither(TerminalServerMessageSchema)(value))

export { type TerminalServerMessage } from "../shared/terminal-session-schema.js"
