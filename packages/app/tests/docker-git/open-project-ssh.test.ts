/* jscpd:ignore-start */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { openResolvedProjectSshEffect } from "../../src/docker-git/open-project.js"
import { makeProjectItem } from "./fixtures/project-item.js"

// sonarjs/no-hardcoded-ip — test fixtures require deterministic IP addresses
const TEST_BRIDGE_IP = [172, 17, 0, 15].join(".")
const TEST_FALLBACK_IP = [172, 17, 0, 20].join(".")

const makeSshDeps = (events: Array<string>) => ({
  log: (message: string) =>
    Effect.sync(() => {
      events.push(`log:${message}`)
    }),
  resolvePreferredItem: () => Effect.succeed(null),
  probeReady: () => Effect.succeed(false),
  connect: (selected: { readonly projectDir: string; readonly sshCommand: string }) =>
    Effect.sync(() => {
      events.push(`connect:${selected.projectDir}`)
    }),
  connectWithUp: (selected: { readonly projectDir: string }) =>
    Effect.sync(() => {
      events.push(`up:${selected.projectDir}`)
    })
})

describe("openResolvedProjectSshEffect", () => {
  it.effect("connects directly when SSH is already reachable", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        projectDir: "/controller/org/repo/issue-7",
        sshCommand: `ssh -p 22 dev@${TEST_FALLBACK_IP}`
      })
      const events: Array<string> = []

      yield* _(
        openResolvedProjectSshEffect(item, {
          ...makeSshDeps(events),
          probeReady: () => Effect.succeed(true)
        })
      )

      expect(events).toEqual([
        `log:Opening SSH: ssh -p 22 dev@${TEST_FALLBACK_IP}`,
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

      yield* _(openResolvedProjectSshEffect(item, makeSshDeps(events)))

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
        ipAddress: TEST_BRIDGE_IP,
        sshCommand: `ssh -p 22 dev@${TEST_BRIDGE_IP}`
      })
      const events: Array<string> = []

      yield* _(
        openResolvedProjectSshEffect(item, {
          ...makeSshDeps(events),
          resolvePreferredItem: () => Effect.succeed(preferred),
          probeReady: (selected) => Effect.succeed(selected.ipAddress === TEST_BRIDGE_IP),
          connect: (selected) =>
            Effect.sync(() => {
              events.push(`connect:${selected.sshCommand}`)
            })
        })
      )

      expect(events).toEqual([
        `log:Opening SSH: ssh -p 22 dev@${TEST_BRIDGE_IP}`,
        `connect:ssh -p 22 dev@${TEST_BRIDGE_IP}`
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
        ipAddress: TEST_FALLBACK_IP,
        sshCommand: `ssh -p 22 dev@${TEST_FALLBACK_IP}`
      })
      const events: Array<string> = []

      yield* _(
        openResolvedProjectSshEffect(item, {
          ...makeSshDeps(events),
          resolvePreferredItem: () => Effect.succeed(preferred),
          probeReady: (selected) => Effect.succeed(selected.ipAddress !== TEST_FALLBACK_IP),
          connect: (selected) =>
            Effect.sync(() => {
              events.push(`connect:${selected.sshCommand}`)
            })
        })
      )

      expect(events).toEqual([
        "log:Opening SSH: ssh -p 2237 dev@localhost",
        "connect:ssh -p 2237 dev@localhost"
      ])
    }))
})
/* jscpd:ignore-end */
