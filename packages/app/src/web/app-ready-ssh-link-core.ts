import type { TerminalSession } from "./api-types.js"
import type { DashboardData } from "./api.js"
import { terminalSessionId, terminalSessionsForProject } from "./terminal-state.js"
import { type ActiveTerminalSession, terminalSessionRoutePath } from "./terminal.js"

const sshPathPrefix = "/ssh/"

export type DashboardProject = DashboardData["projects"][number]
type SessionLookupResult = { readonly sessionId: string }
export type ProjectLookupResult = { readonly terminalId?: string | undefined; readonly token: string }
export type SshLinkRequest =
  | ({ readonly kind: "project" } & ProjectLookupResult)
  | ({ readonly kind: "session" } & SessionLookupResult)

const decodePathTail = (value: string): string =>
  value
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment))
    .join("/")
    .trim()

const readSessionPathRequest = (tail: string): SshLinkRequest | null => {
  const sessionId = decodeURIComponent(tail.slice("session/".length).split("/")[0] ?? "").trim()
  return sessionId.length === 0 ? null : { kind: "session", sessionId }
}

const readSshPathRequest = (url: URL): SshLinkRequest | null => {
  if (!url.pathname.startsWith(sshPathPrefix)) {
    return null
  }
  const tail = url.pathname.slice(sshPathPrefix.length)
  if (tail.startsWith("session/")) {
    return readSessionPathRequest(tail)
  }
  const decoded = decodePathTail(tail)
  const terminalId = url.searchParams.get("terminal")?.trim() || url.searchParams.get("t")?.trim() || undefined
  return decoded.length === 0 ? null : { kind: "project", terminalId, token: decoded }
}

const readSshQueryRequest = (url: URL): SshLinkRequest | null => {
  const queryToken = url.searchParams.get("ssh")?.trim() ?? ""
  const terminalId = url.searchParams.get("terminal")?.trim() || url.searchParams.get("t")?.trim() || undefined
  return queryToken.length === 0 ? null : { kind: "project", terminalId, token: queryToken }
}

export const readSshLinkRequestFromHref = (href: string): SshLinkRequest | null => {
  const url = new URL(href, "http://localhost")
  return readSshPathRequest(url) ?? readSshQueryRequest(url)
}

export const findProjectBySshToken = (
  projects: DashboardData["projects"],
  token: string
): DashboardProject | undefined =>
  projects.find((candidate) => candidate.projectKey === token || candidate.id === token)

export const findLocalTerminalSession = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  sessionId: string
): ActiveTerminalSession | undefined => sessions.find((session) => terminalSessionId(session) === sessionId)

const newestTerminalSession = <A extends { readonly createdAt: string; readonly status?: string }>(
  sessions: ReadonlyArray<A>
): A | null => {
  const reusableSessions = sessions.filter((session) => session.status !== "failed")
  const candidates = reusableSessions.length === 0 ? sessions : reusableSessions
  return candidates.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
}

const selectByExactIdOrUniquePrefix = <A extends { readonly id: string }>(
  sessions: ReadonlyArray<A>,
  selector: string
): A | null => {
  const exact = sessions.find((session) => session.id === selector)
  if (exact !== undefined) {
    return exact
  }
  const matches = sessions.filter((session) => session.id.startsWith(selector))
  return matches.length === 1 ? matches[0] ?? null : null
}

export const selectLocalProjectTerminal = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  activeTerminalSessionId: string | null,
  projectId: string,
  terminalId: string | undefined
): ActiveTerminalSession | null => {
  const projectSessions = terminalSessionsForProject(sessions, projectId)
  if (terminalId !== undefined) {
    return selectByExactIdOrUniquePrefix(
      projectSessions.map((session) => ({ ...session, id: terminalSessionId(session) })),
      terminalId
    )
  }
  const active = projectSessions.find((session) => terminalSessionId(session) === activeTerminalSessionId)
  if (active !== undefined) {
    return active
  }
  const newest = newestTerminalSession(projectSessions.map((session) => session.session))
  return newest === null
    ? null
    : projectSessions.find((session) => terminalSessionId(session) === newest.id) ?? null
}

export const selectWorkspaceTerminalSession = (
  sessions: ReadonlyArray<TerminalSession>,
  activeSessionId: string | null,
  terminalId?: string
): TerminalSession | null => {
  if (terminalId !== undefined) {
    return selectByExactIdOrUniquePrefix(sessions, terminalId)
  }
  if (activeSessionId !== null) {
    const active = sessions.find((session) => session.id === activeSessionId)
    if (active !== undefined) {
      return active
    }
  }
  return newestTerminalSession(sessions)
}

export const sshLinkRequestKey = (request: SshLinkRequest): string =>
  request.kind === "session"
    ? `session:${request.sessionId}`
    : `project:${request.token}:${request.terminalId ?? ""}`

export const resolveMissingSshSessionFallbackPath = (
  href: string,
  sessionId: string,
  error: string
): string | null => {
  if (!error.includes("HTTP 404")) {
    return null
  }
  const url = new URL(href, "http://localhost")
  return url.pathname === terminalSessionRoutePath(sessionId) ? "/menu/select" : null
}
