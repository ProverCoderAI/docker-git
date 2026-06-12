import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { buildContainerTasks } from "../src/services/container-tasks-core.js"
import type { RawContainerProcess } from "../src/services/container-tasks-core.js"

const processOf = (
  patch: Partial<RawContainerProcess> & Pick<RawContainerProcess, "pid" | "ppid" | "command">
): RawContainerProcess => ({
  baseline: false,
  etime: "00:01",
  etimes: 1,
  logAvailable: false,
  tty: "?",
  user: "dev",
  ...patch
})

describe("container task classification", () => {
  it("excludes baseline system processes unless includeDefault is true", () => {
    const tasks = buildContainerTasks(
      [
        processOf({ baseline: true, command: "/usr/sbin/sshd -D", pid: 1, ppid: 0 }),
        processOf({ command: "node server.js", pid: 20, ppid: 1 })
      ],
      [],
      false
    )

    expect(tasks.map((task) => task.pid)).toEqual([20])
    expect(buildContainerTasks([processOf({ baseline: true, command: "/usr/sbin/sshd -D", pid: 1, ppid: 0 })], [], true))
      .toHaveLength(1)
  })

  it("hides browser-connection MCP helpers as internal system tasks", () => {
    const browserCommand =
      "browser-connection --project dg-docker-git-issue-376 --network container:dg-docker-git-issue-376"
    const visible = buildContainerTasks(
      [
        processOf({ command: browserCommand, pid: 11502, ppid: 5142, tty: "pts/1" }),
        processOf({ command: "/usr/local/bin/docker-git-browser-connection start", pid: 11600, ppid: 5142, tty: "pts/1" }),
        processOf({ command: "node server.js", pid: 20, ppid: 1, tty: "pts/2" })
      ],
      [],
      false
    )

    expect(visible.map((task) => task.pid)).toEqual([20])

    const withSystem = buildContainerTasks(
      [processOf({ command: browserCommand, pid: 11502, ppid: 5142, tty: "pts/1" })],
      [],
      true
    )

    expect(withSystem.map((task) => [task.pid, task.kind])).toEqual([[11502, "system"]])
  })

  it("hides any browser-helper command variant regardless of path prefix or arguments", () => {
    const optArgs = fc.option(fc.string({ maxLength: 40 }), { nil: undefined })

    const browserCommandArbitrary = fc.oneof(
      optArgs.map((args) => (args === undefined ? "browser-connection" : `browser-connection ${args}`)),
      optArgs.map((args) =>
        args === undefined ? "docker-git-browser-connection" : `docker-git-browser-connection ${args}`
      ),
      optArgs.map((args) =>
        args === undefined ? "/usr/local/bin/browser-connection" : `/usr/local/bin/browser-connection ${args}`
      ),
      optArgs.map((args) =>
        args === undefined
          ? "/usr/local/bin/docker-git-browser-connection"
          : `/usr/local/bin/docker-git-browser-connection ${args}`
      )
    )

    fc.assert(
      fc.property(browserCommandArbitrary, fc.integer({ min: 1, max: 99999 }), (command, pid) => {
        const hidden = buildContainerTasks(
          [processOf({ command, pid, ppid: 0, tty: "pts/1" })],
          [],
          false
        )
        const shown = buildContainerTasks(
          [processOf({ command, pid, ppid: 0, tty: "pts/1" })],
          [],
          true
        )
        return hidden.length === 0 && shown.every((t) => t.kind === "system")
      })
    )
  })


  it("marks descendants of managed agent pid as agent tasks", () => {
    const tasks = buildContainerTasks(
      [
        processOf({ command: "codex", pid: 10, ppid: 1 }),
        processOf({ command: "bash", pid: 11, ppid: 10, tty: "pts/1" })
      ],
      [{ agentId: "agent-1", pid: 10 }],
      false
    )

    expect(tasks.map((task) => [task.pid, task.kind, task.managedId])).toEqual([
      [10, "agent", "agent-1"],
      [11, "agent", "agent-1"]
    ])
  })
})
