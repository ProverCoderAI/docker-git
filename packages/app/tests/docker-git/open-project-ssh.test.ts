import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { ApiTerminalSession } from "../../src/docker-git/api-terminal-codec.js"
import type { HostError } from "../../src/docker-git/host-errors.js"
import { openHostProjectSshEffect, openResolvedProjectSshEffect } from "../../src/docker-git/open-project.js"
import { makeProjectItem } from "./fixtures/project-item.js"

const makeSession = (): ApiTerminalSession => ({
  id: "session-1",
  projectId: "/controller/org/repo",
  sshCommand: "ssh -p 22 dev@127.0.0.1",
  status: "ready",
  createdAt: "2026-04-10T00:00:00Z"
})

describe("openResolvedProjectSshEffect", () => {
  it.effect("attaches to a prepared terminal session", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({ projectDir: "/controller/org/repo/issue-7" })
      const events = yield* _(captureOpenResolvedProjectSshEvents(item))
      expect(events).toEqual(["create:/controller/org/repo/issue-7", "attach:session-1"])
    }))

  it.effect("fails when controller does not create a terminal session", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({ projectDir: "/controller/org/repo/issue-8" })
      const exit = yield* _(
        openResolvedProjectSshEffect(item, {
          createSession: (projectId) =>
            Effect.sync(() => {
              expect(projectId).toBe("/controller/org/repo/issue-8")
              return null
            }),
          attach: () => Effect.void
        }).pipe(Effect.provide(NodeContext.layer), Effect.exit)
      )

      expect(exit._tag).toBe("Failure")
    }))
})

describe("openHostProjectSshEffect", () => {
  it.effect("writes the header before running ssh", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        displayName: "org/repo",
        sshCommand: "ssh -p 2222 dev@localhost"
      })
      const events = yield* _(captureOpenHostProjectSshEvents(item))
      expect(events).toEqual([
        "header:org/repo:ssh -p 2222 dev@localhost",
        "run:ssh -p 2222 dev@localhost"
      ])
    }))
})

const captureOpenResolvedProjectSshEvents = (
  item: ReturnType<typeof makeProjectItem>
): Effect.Effect<ReadonlyArray<string>, HostError> =>
  Effect.gen(function*(_) {
    const events: Array<string> = []
    yield* _(
      openResolvedProjectSshEffect(item, {
        createSession: (projectId) =>
          Effect.sync(() => {
            events.push(`create:${projectId}`)
            return {
              project: {},
              session: makeSession()
            }
          }),
        attach: (_project, session) =>
          Effect.sync(() => {
            events.push(`attach:${session.id}`)
          })
      })
    )
    return events
  }).pipe(Effect.provide(NodeContext.layer))

const captureOpenHostProjectSshEvents = (
  item: ReturnType<typeof makeProjectItem>
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function*(_) {
    const events: Array<string> = []
    yield* _(
      openHostProjectSshEffect(item, {
        writeHeader: (project) =>
          Effect.sync(() => {
            events.push(`header:${project.displayName}:${project.sshCommand}`)
          }),
        runCommand: (project) =>
          Effect.sync(() => {
            events.push(`run:${project.sshCommand}`)
          })
      })
    )
    return events
  }).pipe(Effect.provide(NodeContext.layer))
