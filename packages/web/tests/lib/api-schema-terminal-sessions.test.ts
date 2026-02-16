import { Either } from "effect"
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"

import { ApiSchema } from "../../src/lib/api-schema"

const decodeTerminalSessions = Schema.decodeUnknownEither(ApiSchema.TerminalSessions)

describe("ApiSchema.TerminalSessions", () => {
  it("decodes sessions with containerName", () => {
    const payload = {
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
    }

    const decoded = decodeTerminalSessions(payload)
    expect(Either.isRight(decoded)).toBe(true)
    if (Either.isLeft(decoded)) {
      return
    }
    expect(decoded.right.sessions[0]?.containerName).toBe("dg-repo-issue-47")
  })

  it("keeps backward compatibility when containerName is absent", () => {
    const payload = {
      sessions: [
        {
          id: "session-legacy",
          projectId: "/tmp/project-legacy",
          displayName: "org/repo",
          mode: "default",
          source: "web",
          status: "connected",
          connectedAt: "2026-02-16T15:00:00.000Z",
          updatedAt: "2026-02-16T15:00:01.000Z"
        }
      ]
    }

    const decoded = decodeTerminalSessions(payload)
    expect(Either.isRight(decoded)).toBe(true)
    if (Either.isLeft(decoded)) {
      return
    }
    expect(decoded.right.sessions[0]?.containerName).toBeUndefined()
  })
})
