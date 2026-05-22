import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import type { TerminalSession } from "../../src/web/api-types.js"
import {
  readSshLinkRequestFromHref,
  resolveMissingSshSessionFallbackPath,
  selectWorkspaceTerminalSession
} from "../../src/web/app-ready-ssh-link-hook.js"

const makeSession = (id: string, createdAt: string, status: TerminalSession["status"] = "ready"): TerminalSession => ({
  createdAt,
  id,
  projectId: "project-1",
  sshCommand: `ssh dev@${id}`,
  status
})

const makeSessionPair = (): ReadonlyArray<TerminalSession> => [
  makeSession("session-1", "2026-04-15T00:00:00.000Z"),
  makeSession("session-2", "2026-04-16T00:00:00.000Z")
]

const createdAtForIndex = (index: number): string => `2026-04-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`

const sessionIdsArbitrary = fc.uniqueArray(fc.integer({ max: 1_000_000, min: 1 }), {
  maxLength: 8,
  minLength: 1
})

const sessionsFromIds = (
  ids: ReadonlyArray<number>,
  statusForIndex: (index: number) => TerminalSession["status"] = () => "ready"
): ReadonlyArray<TerminalSession> =>
  ids.map((id, index) => makeSession(`session-${id}`, createdAtForIndex(index), statusForIndex(index)))

describe("app-ready ssh link hook", () => {
  it("parses stable project SSH routes with an optional terminal selector", () => {
    expect(readSshLinkRequestFromHref("https://docker-git.local/ssh/octocat/hello-world?t=session-2"))
      .toEqual({
        kind: "project",
        terminalId: "session-2",
        token: "octocat/hello-world"
      })
  })

  it("keeps full terminal selector links backward compatible", () => {
    expect(readSshLinkRequestFromHref("https://docker-git.local/ssh/octocat/hello-world?terminal=session-2"))
      .toEqual({
        kind: "project",
        terminalId: "session-2",
        token: "octocat/hello-world"
      })
  })

  it("parses legacy terminal session routes for compatibility redirects", () => {
    expect(readSshLinkRequestFromHref("https://docker-git.local/ssh/session/session-1")).toEqual({
      kind: "session",
      sessionId: "session-1"
    })
  })

  it("ignores malformed percent-encoded SSH paths", () => {
    expect(readSshLinkRequestFromHref("https://docker-git.local/ssh/%E0%A4%A")).toBeNull()
    expect(readSshLinkRequestFromHref("https://docker-git.local/ssh/session/%E0%A4%A")).toBeNull()
  })

  it("selects the requested workspace terminal before the active one", () => {
    expect(selectWorkspaceTerminalSession(makeSessionPair(), "session-1", "session-2")?.id).toBe("session-2")
  })

  it("selects a workspace terminal by a unique short prefix", () => {
    const sessions = [
      makeSession("a5f1c873-358b-4de9-9444-92ee8f8522fb", "2026-04-15T00:00:00.000Z"),
      makeSession("1b73cfc9-6d07-489e-bdc5-99d43f2da2cb", "2026-04-16T00:00:00.000Z")
    ]

    expect(selectWorkspaceTerminalSession(sessions, null, "a5f1c873")?.id).toBe(
      "a5f1c873-358b-4de9-9444-92ee8f8522fb"
    )
  })

  it("does not select a workspace terminal by an ambiguous short prefix", () => {
    const sessions = [
      makeSession("aaaaaaaa-358b-4de9-9444-92ee8f8522fb", "2026-04-15T00:00:00.000Z"),
      makeSession("aaaaaaaa-6d07-489e-bdc5-99d43f2da2cb", "2026-04-16T00:00:00.000Z")
    ]

    expect(selectWorkspaceTerminalSession(sessions, null, "aaaaaaaa")).toBeNull()
  })

  it("does not silently replace a missing requested terminal with another session", () => {
    expect(selectWorkspaceTerminalSession(makeSessionPair(), "session-1", "missing")).toBeNull()
  })

  it("falls back to the newest non-failed workspace terminal", () => {
    const sessions = [
      makeSession("ready-old", "2026-04-15T00:00:00.000Z"),
      makeSession("failed-new", "2026-04-16T00:00:00.000Z", "failed")
    ]

    expect(selectWorkspaceTerminalSession(sessions, null)?.id).toBe("ready-old")
  })

  it("preserves exact terminal selector invariants for generated sessions", () => {
    fc.assert(
      fc.property(sessionIdsArbitrary, fc.nat(), (ids, seed) => {
        const sessions = sessionsFromIds(ids)
        const expected = sessions[seed % sessions.length]

        expect(selectWorkspaceTerminalSession(sessions, null, expected?.id)?.id).toBe(expected?.id)
      }),
      { numRuns: 50 }
    )
  })

  it("preserves unique and ambiguous terminal prefix invariants", () => {
    fc.assert(
      fc.property(fc.integer({ max: 1_000_000, min: 1 }), (seed) => {
        const prefix = `prefix-${seed}-`
        const uniqueSessions = [
          makeSession(`${prefix}a`, "2026-04-15T00:00:00.000Z"),
          makeSession(`other-${seed}`, "2026-04-16T00:00:00.000Z")
        ]
        const ambiguousSessions = [
          makeSession(`${prefix}a`, "2026-04-15T00:00:00.000Z"),
          makeSession(`${prefix}b`, "2026-04-16T00:00:00.000Z")
        ]

        expect(selectWorkspaceTerminalSession(uniqueSessions, null, prefix)?.id).toBe(`${prefix}a`)
        expect(selectWorkspaceTerminalSession(ambiguousSessions, null, prefix)).toBeNull()
      }),
      { numRuns: 50 }
    )
  })

  it("preserves missing terminal selector invariants for generated sessions", () => {
    fc.assert(
      fc.property(sessionIdsArbitrary, fc.integer({ max: 1_000_000, min: 1 }), (ids, seed) => {
        const sessions = sessionsFromIds(ids)

        expect(selectWorkspaceTerminalSession(sessions, sessions[0]?.id ?? null, `missing-${seed}`)).toBeNull()
      }),
      { numRuns: 50 }
    )
  })

  it("preserves newest non-failed fallback invariants for generated sessions", () => {
    fc.assert(
      fc.property(sessionIdsArbitrary, fc.nat(), (ids, seed) => {
        const sessions = sessionsFromIds(ids, (index) => index % 2 === seed % 2 ? "failed" : "ready")
        const reusable = sessions.filter((session) => session.status !== "failed")
        const candidates = reusable.length === 0 ? sessions : reusable
        const expected = candidates.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

        expect(selectWorkspaceTerminalSession(sessions, null)?.id).toBe(expected?.id)
      }),
      { numRuns: 50 }
    )
  })

  it("falls back to the Select screen for a stale SSH session route", () => {
    expect(
      resolveMissingSshSessionFallbackPath(
        "https://docker-git.local/ssh/session/session-1",
        "session-1",
        "HTTP 404"
      )
    ).toBe("/menu/select")
  })

  it("keeps the current route for non-404 session attach errors", () => {
    expect(
      resolveMissingSshSessionFallbackPath(
        "https://docker-git.local/ssh/session/session-1",
        "session-1",
        "HTTP 429: tunnel or proxy rate limited the request."
      )
    ).toBeNull()
  })

  it("ignores unrelated routes even when the API returns 404", () => {
    expect(
      resolveMissingSshSessionFallbackPath(
        "https://docker-git.local/browser/octocat/hello-world",
        "session-1",
        "HTTP 404"
      )
    ).toBeNull()
  })
})
