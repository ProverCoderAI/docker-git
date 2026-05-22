import { Either } from "effect"

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

const safeDecodeURIComponent = (value: string): string | null =>
  Either.getOrNull(Either.try({ try: () => decodeURIComponent(value), catch: () => null }))

const decodePathTail = (value: string): string | null => {
  const decodedSegments = value
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => safeDecodeURIComponent(segment))
  return decodedSegments.includes(null)
    ? null
    : decodedSegments.join("/").trim()
}

const readSessionPathRequest = (tail: string): SshLinkRequest | null => {
  const decoded = safeDecodeURIComponent(tail.slice("session/".length).split("/")[0] ?? "")
  const sessionId = decoded?.trim() ?? ""
  return sessionId.length === 0 ? null : { kind: "session", sessionId }
}

const nonEmptyQueryValue = (value: string | null): string | undefined => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length === 0 ? undefined : trimmed
}

const readTerminalIdQuery = (url: URL): string | undefined =>
  nonEmptyQueryValue(url.searchParams.get("terminal")) ?? nonEmptyQueryValue(url.searchParams.get("t"))

const readProjectPathRequest = (url: URL, tail: string): SshLinkRequest | null => {
  const decoded = decodePathTail(tail)
  return decoded === null || decoded.length === 0
    ? null
    : { kind: "project", terminalId: readTerminalIdQuery(url), token: decoded }
}

const readSshPathRequest = (url: URL): SshLinkRequest | null => {
  if (!url.pathname.startsWith(sshPathPrefix)) {
    return null
  }
  const tail = url.pathname.slice(sshPathPrefix.length)
  if (tail.startsWith("session/")) {
    return readSessionPathRequest(tail)
  }
  return readProjectPathRequest(url, tail)
}

const readSshQueryRequest = (url: URL): SshLinkRequest | null => {
  const queryToken = url.searchParams.get("ssh")?.trim() ?? ""
  const terminalId = readTerminalIdQuery(url)
  return queryToken.length === 0 ? null : { kind: "project", terminalId, token: queryToken }
}

// CHANGE: Parse browser SSH deep links without throwing on malformed input.
// WHY: User-controlled href/path segments must collapse to null, not crash rendering.
// QUOTE(TZ): CodeRabbit #342: "malformed % encodings yield null/ignored values rather than throwing".
// REF: PR #342 review, issue #340.
// SOURCE: n/a
// FORMAT THEOREM: forall href: invalid(href) => readSshLinkRequestFromHref(href) = null.
// PURITY: CORE
// EFFECT: none
// INVARIANT: Returned requests always have a non-empty project token or session id.
// COMPLEXITY: O(n) time/O(n) space where n = href length.
/**
 * Reads a project or session SSH link request from an absolute or relative href.
 *
 * @param href - Browser href value to parse against a local base URL.
 * @returns Parsed SSH request, or null when the route is unrelated or malformed.
 * @pure true
 * @effect none
 * @invariant A non-null result contains a non-empty token or session id.
 * @precondition href may be any string.
 * @postcondition Malformed URL or percent-encoding input returns null.
 * @complexity O(n) time/O(n) space where n is href length.
 * @throws Never
 */
export const readSshLinkRequestFromHref = (href: string): SshLinkRequest | null => {
  const url = Either.getOrNull(Either.try({ try: () => new URL(href, "http://localhost"), catch: () => null }))
  if (url === null) {
    return null
  }
  return readSshPathRequest(url) ?? readSshQueryRequest(url)
}

// CHANGE: Select a dashboard project by either stable SSH token form.
// WHY: SSH links may carry the project key or the project id depending on source.
// QUOTE(TZ): n/a
// REF: PR #342 SSH terminal link handling.
// SOURCE: n/a
// FORMAT THEOREM: forall p in projects: match(token,p) => result = first matching p.
// PURITY: CORE
// EFFECT: none
// INVARIANT: Search order follows the dashboard project order.
// COMPLEXITY: O(n) time/O(1) space where n = projects length.
/**
 * Finds the first project whose project key or id equals the SSH token.
 *
 * @param projects - Dashboard project collection.
 * @param token - Project key or project id carried by an SSH link.
 * @returns Matching project, or undefined when none exists.
 * @pure true
 * @effect none
 * @invariant The returned project is a member of projects.
 * @precondition projects is a finite readonly array.
 * @postcondition Undefined means no project key or id equals token.
 * @complexity O(n) time/O(1) space where n is projects length.
 * @throws Never
 */
export const findProjectBySshToken = (
  projects: DashboardData["projects"],
  token: string
): DashboardProject | undefined =>
  projects.find((candidate) => candidate.projectKey === token || candidate.id === token)

// CHANGE: Resolve an already-open terminal session by canonical session id.
// WHY: Deep links should reuse local sessions before requesting backend state.
// QUOTE(TZ): n/a
// REF: PR #342 SSH terminal link handling.
// SOURCE: n/a
// FORMAT THEOREM: forall s in sessions: id(s)=sessionId => result = first s.
// PURITY: CORE
// EFFECT: none
// INVARIANT: The returned session is a member of sessions.
// COMPLEXITY: O(n) time/O(1) space where n = sessions length.
/**
 * Finds a local active terminal session by its canonical terminal session id.
 *
 * @param sessions - Open terminal sessions in the browser state.
 * @param sessionId - Terminal session id to find.
 * @returns Matching active session, or undefined when not open locally.
 * @pure true
 * @effect none
 * @invariant The result is undefined or belongs to sessions.
 * @precondition sessions is finite and each session has a stable id.
 * @postcondition Undefined means no local terminal id equals sessionId.
 * @complexity O(n) time/O(1) space where n is sessions length.
 * @throws Never
 */
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

// CHANGE: Choose the best local terminal for a project SSH link.
// WHY: Selection must prefer explicit ids, then current active session, then newest reusable session.
// QUOTE(TZ): n/a
// REF: PR #342 SSH terminal link handling.
// SOURCE: n/a
// FORMAT THEOREM: terminalId defined => result id matches exact/unique prefix or null.
// PURITY: CORE
// EFFECT: none
// INVARIANT: Non-null result belongs to the requested project.
// COMPLEXITY: O(n log n) time/O(n) space where n = sessions length.
/**
 * Selects a local project terminal for a project link.
 *
 * @param sessions - Active terminal sessions in browser memory.
 * @param activeTerminalSessionId - Current active terminal id, when any.
 * @param projectId - Project id that must own the returned session.
 * @param terminalId - Optional exact id or unique id prefix requested by the link.
 * @returns The selected active session, or null when no local session satisfies the request.
 * @pure true
 * @effect none
 * @invariant Non-null results belong to projectId.
 * @precondition terminalId, when supplied, is compared as an id prefix or exact id.
 * @postcondition Missing explicit terminalId may fall back to active or newest non-failed session.
 * @complexity O(n log n) time/O(n) space where n is sessions length.
 * @throws Never
 */
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

// CHANGE: Choose the backend workspace terminal targeted by an SSH link.
// WHY: Backend attach should honor explicit selectors before falling back to active/newest sessions.
// QUOTE(TZ): n/a
// REF: PR #342 SSH terminal link handling.
// SOURCE: n/a
// FORMAT THEOREM: terminalId defined => result id matches exact/unique prefix or null.
// PURITY: CORE
// EFFECT: none
// INVARIANT: Non-null result belongs to sessions.
// COMPLEXITY: O(n log n) time/O(n) space where n = sessions length.
/**
 * Selects a terminal session from a backend workspace session list.
 *
 * @param sessions - Backend terminal sessions for one workspace.
 * @param activeSessionId - Backend active session id, when any.
 * @param terminalId - Optional exact id or unique id prefix requested by the link.
 * @returns Selected terminal session, or null when an explicit selector is missing or ambiguous.
 * @pure true
 * @effect none
 * @invariant Non-null results belong to sessions.
 * @precondition sessions is finite and ordered independently from selection semantics.
 * @postcondition Without terminalId, stale activeSessionId falls back to newest reusable session.
 * @complexity O(n log n) time/O(n) space where n is sessions length.
 * @throws Never
 */
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

// CHANGE: Derive a stable idempotency key for one parsed SSH request.
// WHY: The hook needs to distinguish new links from already-handled links.
// QUOTE(TZ): n/a
// REF: PR #342 SSH terminal link handling.
// SOURCE: n/a
// FORMAT THEOREM: equal request fields => equal key.
// PURITY: CORE
// EFFECT: none
// INVARIANT: The key prefix equals the request discriminant.
// COMPLEXITY: O(n) time/O(n) space where n = encoded field length.
/**
 * Renders a stable key for deduplicating SSH link handling.
 *
 * @param request - Parsed SSH project or session request.
 * @returns Stable string key containing request kind and identity fields.
 * @pure true
 * @effect none
 * @invariant Session keys start with session: and project keys start with project:.
 * @precondition request is a valid SshLinkRequest.
 * @postcondition Equal request identity fields produce equal keys.
 * @complexity O(n) time/O(n) space where n is request field length.
 * @throws Never
 */
export const sshLinkRequestKey = (request: SshLinkRequest): string =>
  request.kind === "session"
    ? `session:${request.sessionId}`
    : `project:${request.token}:${request.terminalId ?? ""}`

// CHANGE: Compute a safe fallback route for stale SSH session links.
// WHY: A 404 for the currently-open session route should return users to Select instead of looping.
// QUOTE(TZ): n/a
// REF: PR #342 SSH terminal link handling.
// SOURCE: n/a
// FORMAT THEOREM: error lacks HTTP 404 => result = null.
// PURITY: CORE
// EFFECT: none
// INVARIANT: Non-null result is always /menu/select.
// COMPLEXITY: O(n) time/O(n) space where n = href length.
/**
 * Resolves the browser fallback path for a stale terminal session deep link.
 *
 * @param href - Current browser href.
 * @param sessionId - Session id whose attach attempt failed.
 * @param error - Typed API error message.
 * @returns /menu/select only for matching session routes that failed with HTTP 404.
 * @pure true
 * @effect none
 * @invariant Non-null result is the Select route.
 * @precondition href may be any string and error is an API message.
 * @postcondition Malformed href or non-404 errors return null.
 * @complexity O(n) time/O(n) space where n is href length.
 * @throws Never
 */
export const resolveMissingSshSessionFallbackPath = (
  href: string,
  sessionId: string,
  error: string
): string | null => {
  if (!error.includes("HTTP 404")) {
    return null
  }
  const url = Either.getOrNull(Either.try({ try: () => new URL(href, "http://localhost"), catch: () => null }))
  if (url === null) {
    return null
  }
  return url.pathname === terminalSessionRoutePath(sessionId) ? "/menu/select" : null
}
