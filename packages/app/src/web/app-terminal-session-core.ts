import type { ProjectTerminalSessionLookup } from "./api.js"
import { type ActiveTerminalSession, buildProjectActiveTerminalSession } from "./terminal.js"

export type WebAppRoute = { readonly tag: "Dashboard" }

const terminalSessionRoutePrefix = "/ssh/session/"

export const readTerminalSessionRoute = (pathname: string): string | null => {
  if (!pathname.startsWith(terminalSessionRoutePrefix)) {
    return null
  }

  const rawSessionId = pathname.slice(terminalSessionRoutePrefix.length).split("/", 1)[0] ?? ""
  const sessionId = decodeURIComponent(rawSessionId).trim()
  return sessionId.length === 0 ? null : sessionId
}

export const resolveWebAppRoute = (_pathname: string): WebAppRoute => {
  return { tag: "Dashboard" }
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
