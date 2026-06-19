import type { ProjectTerminalSessionLookup } from "./api.js"
import { type ActiveTerminalSession, buildProjectActiveTerminalSession } from "./terminal.js"

export type WebAppRoute =
  | { readonly tag: "Dashboard" }
  | { readonly tag: "ShareLink"; readonly projectKey: string; readonly shareToken: string }

const terminalSessionRoutePrefix = "/ssh/session/"

export const readTerminalSessionRoute = (pathname: string): string | null => {
  if (!pathname.startsWith(terminalSessionRoutePrefix)) {
    return null
  }

  const rawSessionId = pathname.slice(terminalSessionRoutePrefix.length).split("/", 1)[0] ?? ""
  const sessionId = decodeURIComponent(rawSessionId).trim()
  return sessionId.length === 0 ? null : sessionId
}

// CHANGE: detect 16-hex share tokens in /ssh/:projectKey?t=:token URLs
// WHY: share tokens (16 hex chars) are distinct from terminal UUIDs (dashed UUID format)
// QUOTE(ТЗ): "принимает ссылку на любой IP который стоит у пользователя в URL"
// REF: issue-428
// FORMAT THEOREM: ∀t: isShareToken(t) ↔ t ∈ [0-9a-f]{16}
// PURITY: CORE
// INVARIANT: UUID terminal IDs always have dashes — never match the hex-only pattern
// COMPLEXITY: O(1)
const isShareToken = (value: string): boolean => /^[0-9a-f]{16}$/u.test(value)

const safeDecodeSegment = (value: string): string | null => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export const resolveWebAppRoute = (pathname: string, search: string = ""): WebAppRoute => {
  if (pathname.startsWith("/ssh/")) {
    const rawKey = pathname.slice("/ssh/".length).split("/")[0] ?? ""
    const projectKey = safeDecodeSegment(rawKey)?.trim() ?? ""
    const t = new URLSearchParams(search).get("t") ?? ""
    if (projectKey.length > 0 && isShareToken(t)) {
      return { tag: "ShareLink", projectKey, shareToken: t }
    }
  }
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
