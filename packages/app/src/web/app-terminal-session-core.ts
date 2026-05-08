import type { ProjectTerminalSessionLookup } from "./api.js"
import { type ActiveTerminalSession, buildProjectActiveTerminalSession } from "./terminal.js"

export type WebAppRoute =
  | { readonly tag: "Dashboard" }
  | { readonly tag: "TerminalSession"; readonly sessionId: string }

const terminalSessionRoutePrefix = "/ssh/session/"

export const readTerminalSessionRoute = (pathname: string): string | null => {
  if (!pathname.startsWith(terminalSessionRoutePrefix)) {
    return null
  }

  const rawSessionId = pathname.slice(terminalSessionRoutePrefix.length).split("/")[0] ?? ""
  const sessionId = decodeURIComponent(rawSessionId).trim()
  return sessionId.length === 0 ? null : sessionId
}

export const resolveWebAppRoute = (pathname: string): WebAppRoute => {
  const sessionId = readTerminalSessionRoute(pathname)
  return sessionId === null
    ? { tag: "Dashboard" }
    : { tag: "TerminalSession", sessionId }
}

export const buildTerminalOnlyActiveSession = (
  lookup: ProjectTerminalSessionLookup
): ActiveTerminalSession =>
  buildProjectActiveTerminalSession({
    projectDisplayName: lookup.projectDisplayName,
    projectId: lookup.session.projectId,
    projectKey: lookup.projectKey,
    session: lookup.session
  })
