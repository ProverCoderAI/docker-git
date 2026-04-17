import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { ApiTerminalSession } from "../../src/docker-git/api-terminal-codec.js"
import type { HostError } from "../../src/docker-git/host-errors.js"
import {
  openHostProjectSshEffect,
  openResolvedProjectSshEffect,
  openResolvedProjectSshWithUpEffect
} from "../../src/docker-git/open-project.js"
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

describe("openResolvedProjectSshWithUpEffect", () => {
  it.effect("starts the project before opening SSH", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        displayName: "org/repo",
        projectDir: "/controller/org/repo/issue-9"
      })
      const events = yield* _(captureOpenResolvedProjectSshWithUpEvents(item))
      expect(events).toEqual([
        "up:/controller/org/repo/issue-9",
        "open:ssh -p 2299 dev@127.0.0.1"
      ])
    }))

  it.effect("falls back to the original item when up does not return refreshed project details", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        displayName: "org/repo",
        projectDir: "/controller/org/repo/issue-10",
        sshCommand: "ssh -p 2222 dev@localhost"
      })
      const events = yield* _(
        openResolvedProjectSshWithUpEffect(item, {
          upProject: (projectId) =>
            Effect.sync(() => {
              expect(projectId).toBe("/controller/org/repo/issue-10")
              return null
            }),
          openProjectSsh: (project) =>
            Effect.sync(() => {
              expect(project.sshCommand).toBe("ssh -p 2222 dev@localhost")
              expect(project.projectDir).toBe("/controller/org/repo/issue-10")
            })
        }).pipe(Effect.as(["fallback"]))
      )

      expect(events).toEqual(["fallback"])
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

const captureOpenResolvedProjectSshWithUpEvents = (
  item: ReturnType<typeof makeProjectItem>
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function*(_) {
    const events: Array<string> = []
    yield* _(
      openResolvedProjectSshWithUpEffect(item, {
        upProject: (projectId) =>
          Effect.sync(() => {
            events.push(`up:${projectId}`)
            return {
              ...item,
              sshCommand: "ssh -p 2299 dev@127.0.0.1",
              sshPort: 2299,
              status: "running" as const,
              statusLabel: "running"
            }
          }),
        openProjectSsh: (project) =>
          Effect.sync(() => {
            events.push(`open:${project.sshCommand}`)
          })
      })
    )
    return events
  }).pipe(Effect.provide(NodeContext.layer))
