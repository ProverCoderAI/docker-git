import { describe, expect, it } from "vitest"

import {
  decodeContainerTaskSnapshot,
  renderContainerTaskSnapshot
} from "../../src/docker-git/api-container-tasks-codec.js"

describe("api container task codec", () => {
  it("decodes and renders task snapshots", () => {
    const snapshot = decodeContainerTaskSnapshot({
      snapshot: {
        containerName: "project-dev",
        generatedAt: "2026-04-22T00:00:00.000Z",
        projectId: "/home/dev/.docker-git/demo",
        sshConnections: 1,
        tasks: [
          {
            command: "codex",
            etime: "00:03",
            etimes: 3,
            kind: "agent",
            logAvailable: true,
            managedId: "agent-1",
            pid: 42,
            ppid: 1,
            tty: "pts/0",
            user: "dev"
          }
        ]
      }
    })

    expect(snapshot?.tasks[0]?.kind).toBe("agent")
    expect(snapshot === null ? "" : renderContainerTaskSnapshot(snapshot)).toContain("PID")
    expect(snapshot === null ? "" : renderContainerTaskSnapshot(snapshot)).toContain("codex")
  })
})
