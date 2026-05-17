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

type ProjectTerminalSessionBaseArgs = {
  readonly projectDisplayName: string
  readonly projectId: string
  readonly projectKey: string
  readonly sessionId: string
}

type ProjectTerminalSessionBase = Pick<
  ActiveTerminalSession,
  | "browserProjectId"
  | "browserProjectKey"
  | "browserProjectName"
  | "closePath"
  | "header"
  | "readyMessage"
  | "websocketPath"
>

export const terminalSessionRoutePath = (sessionId: string): string => `/ssh/session/${encodeURIComponent(sessionId)}`

const encodeProjectKeyPath = (projectKey: string): string =>
  projectKey.split("/").map((segment) => encodeURIComponent(segment)).join("/")

const terminalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export const terminalRouteToken = (sessionId: string): string =>
  terminalUuidPattern.test(sessionId) ? sessionId.slice(0, 8) : sessionId

export const projectSshRoutePath = (projectKey: string, terminalId?: string): string => {
  const path = `/ssh/${encodeProjectKeyPath(projectKey)}`
  return terminalId === undefined ? path : `${path}?t=${encodeURIComponent(terminalRouteToken(terminalId))}`
}

type TerminalLabelSession = {
  readonly createdAt: string
  readonly id: string
}

const compareTerminalLabelSession = (left: TerminalLabelSession, right: TerminalLabelSession): number => {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt
}

export const terminalTitle = (index: number): string => `Terminal ${index + 1}`

const terminalTitleEntry = (
  session: TerminalLabelSession,
  index: number
): readonly [string, string] => [session.id, terminalTitle(index)]

export const terminalTitleById = (
  sessions: ReadonlyArray<TerminalLabelSession>
): ReadonlyMap<string, string> =>
  new Map(
    sessions
      .toSorted(compareTerminalLabelSession)
      .map((session, index) => terminalTitleEntry(session, index))
  )

export const isPendingActiveTerminalSession = (
  session: ActiveTerminalSession
): session is PendingActiveTerminalSession => session.pendingConnection !== undefined

const buildProjectTerminalSessionBase = (
  { projectDisplayName, projectId, projectKey, sessionId }: ProjectTerminalSessionBaseArgs
): ProjectTerminalSessionBase => {
  const encodedProjectKey = encodeURIComponent(projectKey)
  const encodedSessionId = encodeURIComponent(sessionId)
  const terminalSessionPath = `/projects/by-key/${encodedProjectKey}/terminal-sessions/${encodedSessionId}`
  return {
    browserProjectId: projectId,
    browserProjectKey: projectKey,
    browserProjectName: projectDisplayName,
    closePath: terminalSessionPath,
    header: `SSH terminal: ${projectDisplayName}`,
    readyMessage: `SSH connected: ${projectDisplayName}.`,
    websocketPath: `${terminalSessionPath}/ws`
  }
}

export const buildProjectActiveTerminalSession = (
  { onExit, onReady, projectDisplayName, projectId, projectKey, session }: ProjectActiveTerminalSessionArgs
): ActiveTerminalSession => {
  const base = buildProjectTerminalSessionBase({
    projectDisplayName,
    projectId,
    projectKey,
    sessionId: session.id
  })
  return {
    ...base,
    exitMessage: "SSH session ended.",
    ...(onExit === undefined ? {} : { onExit }),
    ...(onReady === undefined ? {} : { onReady }),
    pendingDeleteMessage: `Terminal session was closed before attach: ${projectDisplayName}.`,
    session,
    sessionPath: projectSshRoutePath(projectKey, session.id),
    subtitle: session.sshCommand
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
  const base = buildProjectTerminalSessionBase({
    projectDisplayName,
    projectId,
    projectKey,
    sessionId: pendingSessionId
  })
  const resolvedMessage = resolvePendingProjectMessage(message, phase)
  return {
    ...base,
    exitMessage: "Pending SSH session closed.",
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
    sessionPath: projectSshRoutePath(projectKey, pendingSessionId),
    subtitle: resolvedMessage
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
