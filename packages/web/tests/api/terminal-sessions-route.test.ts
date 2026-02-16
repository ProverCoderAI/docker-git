import fs from "node:fs"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET } from "../../src/app/api/terminal-sessions/route"

const sessionsFile = "/tmp/docker-git-terminal-sessions.json"

let previousSessionsFileContent: string | null = null

beforeEach(() => {
  previousSessionsFileContent = fs.existsSync(sessionsFile)
    ? fs.readFileSync(sessionsFile, "utf8")
    : null
})

afterEach(() => {
  if (previousSessionsFileContent === null) {
    if (fs.existsSync(sessionsFile)) {
      fs.unlinkSync(sessionsFile)
    }
    return
  }
  fs.writeFileSync(sessionsFile, previousSessionsFileContent, "utf8")
})

describe("GET /api/terminal-sessions", () => {
  it("returns sessions with containerName", async () => {
    fs.writeFileSync(
      sessionsFile,
      JSON.stringify({
        sessions: [
          {
            id: "session-1",
            projectId: "/tmp/project",
            displayName: "org/repo",
            containerName: "dg-repo-issue-47",
            mode: "default",
            source: "web",
            status: "connected",
            connectedAt: "2026-02-16T15:00:00.000Z",
            updatedAt: "2026-02-16T15:00:01.000Z"
          }
        ]
      }),
      "utf8"
    )

    const response = GET()
    const body = await response.json()
    const sessions = Reflect.get(body as object, "sessions")
    expect(Array.isArray(sessions)).toBe(true)
    const first = Array.isArray(sessions) ? sessions[0] : null
    expect(first).toMatchObject({
      id: "session-1",
      containerName: "dg-repo-issue-47",
      status: "connected"
    })
  })

  it("returns an empty list when sessions file is missing", async () => {
    if (fs.existsSync(sessionsFile)) {
      fs.unlinkSync(sessionsFile)
    }
    const response = GET()
    const body = await response.json()
    expect(body).toEqual({ sessions: [] })
  })
})
