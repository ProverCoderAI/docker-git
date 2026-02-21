import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { clearProjectEvents, emitProjectEvent, latestProjectCursor, listProjectEventsSince } from "../src/services/events.js"

describe("events service", () => {
  it.effect("keeps monotonic cursor per project", () =>
    Effect.sync(() => {
      const projectId = "project-a"
      clearProjectEvents(projectId)

      const first = emitProjectEvent(projectId, "project.deployment.status", { phase: "build" })
      const second = emitProjectEvent(projectId, "project.deployment.log", { line: "ok" })

      expect(first.seq).toBe(1)
      expect(second.seq).toBe(2)
      expect(latestProjectCursor(projectId)).toBe(2)

      const next = listProjectEventsSince(projectId, 1)
      expect(next).toHaveLength(1)
      expect(next[0]?.seq).toBe(2)
    }))
})
