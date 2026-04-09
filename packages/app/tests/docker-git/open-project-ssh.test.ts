import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { ProjectItem } from "@lib/usecases/projects"

import { liveFallbackIp, liveRuntimeIp } from "./fixtures/open-project-helpers.js"
import { captureOpenResolvedProjectSshEvents } from "./fixtures/open-project-ssh-helpers.js"
import { makeProjectItem } from "./fixtures/project-item.js"

type RuntimePreferenceCase = {
  readonly name: string
  readonly projectDir: string
  readonly localSshCommand: string
  readonly sshPort: number
  readonly preferredIp: string
  readonly preferredSshCommand: string
  readonly probeReady: (selected: ProjectItem) => boolean
  readonly expected: ReadonlyArray<string>
}

const runtimePreferenceCases: ReadonlyArray<RuntimePreferenceCase> = [
  {
    name: "prefers a live runtime SSH target before falling back to docker up",
    projectDir: "/controller/org/repo/issue-9",
    localSshCommand: "ssh -p 2253 dev@localhost",
    sshPort: 2253,
    preferredIp: liveRuntimeIp,
    preferredSshCommand: `ssh -p 22 dev@${liveRuntimeIp}`,
    probeReady: (selected: ProjectItem) => selected.ipAddress === liveRuntimeIp,
    expected: [
      `log:Opening SSH: ssh -p 22 dev@${liveRuntimeIp}`,
      `connect:ssh -p 22 dev@${liveRuntimeIp}`
    ]
  },
  {
    name: "falls back to the original SSH target when live runtime probe fails",
    projectDir: "/controller/org/repo/issue-10",
    localSshCommand: "ssh -p 2237 dev@localhost",
    sshPort: 2237,
    preferredIp: liveFallbackIp,
    preferredSshCommand: `ssh -p 22 dev@${liveFallbackIp}`,
    probeReady: (selected: ProjectItem) => selected.ipAddress !== liveFallbackIp,
    expected: [
      "log:Opening SSH: ssh -p 2237 dev@localhost",
      "connect:ssh -p 2237 dev@localhost"
    ]
  }
]

describe("openResolvedProjectSshEffect", () => {
  it.effect("connects directly when SSH is already reachable", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        projectDir: "/controller/org/repo/issue-7",
        sshCommand: `ssh -p 22 dev@${liveFallbackIp}`
      })
      const events = yield* _(captureOpenResolvedProjectSshEvents(item))
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
      const events = yield* _(
        captureOpenResolvedProjectSshEvents(item, {
          probeReady: () => Effect.succeed(false)
        })
      )
      expect(events).toEqual([
        "log:Opening SSH: ssh -p 2222 dev@localhost",
        "up:/controller/org/repo/issue-8"
      ])
    }))

  for (const testCase of runtimePreferenceCases) {
    it.effect(testCase.name, () =>
      Effect.gen(function*(_) {
        const item = makeProjectItem({
          projectDir: testCase.projectDir,
          sshCommand: testCase.localSshCommand,
          sshPort: testCase.sshPort
        })
        const preferred = makeProjectItem({
          ...item,
          ipAddress: testCase.preferredIp,
          sshCommand: testCase.preferredSshCommand
        })
        const events = yield* _(
          captureOpenResolvedProjectSshEvents(item, {
            resolvePreferredItem: () => Effect.succeed(preferred),
            probeReady: (selected) => Effect.succeed(testCase.probeReady(selected)),
            connectEntry: (selected) => `connect:${selected.sshCommand}`
          })
        )
        expect(events).toEqual(testCase.expected)
      }))
  }
})
