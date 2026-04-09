import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { openResolvedProjectSshEffect } from "../../src/docker-git/open-project.js"
import { liveFallbackIp, liveRuntimeIp } from "./fixtures/open-project-helpers.js"
import { makeProjectItem } from "./fixtures/project-item.js"

describe("openResolvedProjectSshEffect", () => {
  it.effect("connects directly when SSH is already reachable", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        projectDir: "/controller/org/repo/issue-7",
        sshCommand: `ssh -p 22 dev@${liveFallbackIp}`
      })
      const events: Array<string> = []

      yield* _(
        openResolvedProjectSshEffect(item, {
          log: (message) =>
            Effect.sync(() => {
              events.push(`log:${message}`)
            }),
          resolvePreferredItem: () => Effect.succeed(null),
          probeReady: () => Effect.succeed(true),
          connect: (selected) =>
            Effect.sync(() => {
              events.push(`connect:${selected.projectDir}`)
            }),
          connectWithUp: (selected) =>
            Effect.sync(() => {
              events.push(`up:${selected.projectDir}`)
            })
        })
      )

      expect(events).toEqual([
        `log:Opening SSH: ssh -p 22 dev@${liveFallbackIp}`,
        "connect:/controller/org/repo/issue-7"
      ])
    }))

  it.effect("falls back to docker up when SSH is not yet reachable", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        projectDir: "/controller/org/repo/issue-8",
        sshCommand: "ssh -p 2222 dev@localhost"
      })
      const events: Array<string> = []

      yield* _(
        openResolvedProjectSshEffect(item, {
          log: (message) =>
            Effect.sync(() => {
              events.push(`log:${message}`)
            }),
          resolvePreferredItem: () => Effect.succeed(null),
          probeReady: () => Effect.succeed(false),
          connect: (selected) =>
            Effect.sync(() => {
              events.push(`connect:${selected.projectDir}`)
            }),
          connectWithUp: (selected) =>
            Effect.sync(() => {
              events.push(`up:${selected.projectDir}`)
            })
        })
      )

      expect(events).toEqual([
        "log:Opening SSH: ssh -p 2222 dev@localhost",
        "up:/controller/org/repo/issue-8"
      ])
    }))

  it.effect("prefers a live runtime SSH target before falling back to docker up", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        projectDir: "/controller/org/repo/issue-9",
        sshCommand: "ssh -p 2253 dev@localhost",
        sshPort: 2253
      })
      const preferred = makeProjectItem({
        ...item,
        ipAddress: liveRuntimeIp,
        sshCommand: `ssh -p 22 dev@${liveRuntimeIp}`
      })
      const events: Array<string> = []

      yield* _(
        openResolvedProjectSshEffect(item, {
          log: (message) =>
            Effect.sync(() => {
              events.push(`log:${message}`)
            }),
          resolvePreferredItem: () => Effect.succeed(preferred),
          probeReady: (selected) => Effect.succeed(selected.ipAddress === liveRuntimeIp),
          connect: (selected) =>
            Effect.sync(() => {
              events.push(`connect:${selected.sshCommand}`)
            }),
          connectWithUp: (selected) =>
            Effect.sync(() => {
              events.push(`up:${selected.projectDir}`)
            })
        })
      )

      expect(events).toEqual([
        `log:Opening SSH: ssh -p 22 dev@${liveRuntimeIp}`,
        `connect:ssh -p 22 dev@${liveRuntimeIp}`
      ])
    }))

  it.effect("falls back to the original SSH target when live runtime probe fails", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        projectDir: "/controller/org/repo/issue-10",
        sshCommand: "ssh -p 2237 dev@localhost",
        sshPort: 2237
      })
      const preferred = makeProjectItem({
        ...item,
        ipAddress: liveFallbackIp,
        sshCommand: `ssh -p 22 dev@${liveFallbackIp}`
      })
      const events: Array<string> = []

      yield* _(
        openResolvedProjectSshEffect(item, {
          log: (message) =>
            Effect.sync(() => {
              events.push(`log:${message}`)
            }),
          resolvePreferredItem: () => Effect.succeed(preferred),
          probeReady: (selected) => Effect.succeed(selected.ipAddress !== liveFallbackIp),
          connect: (selected) =>
            Effect.sync(() => {
              events.push(`connect:${selected.sshCommand}`)
            }),
          connectWithUp: (selected) =>
            Effect.sync(() => {
              events.push(`up:${selected.projectDir}`)
            })
        })
      )

      expect(events).toEqual([
        "log:Opening SSH: ssh -p 2237 dev@localhost",
        "connect:ssh -p 2237 dev@localhost"
      ])
    }))
})
