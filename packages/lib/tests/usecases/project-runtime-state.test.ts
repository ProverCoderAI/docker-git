import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  projectRuntimeStateRelativePath,
  readProjectRuntimeState,
  recordProjectRuntimeActivity,
  recordProjectRuntimeResourceProfile,
  recordProjectRuntimeStarted,
  recordProjectRuntimeStopped
} from "../../src/usecases/project-runtime-state.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-runtime-state-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

describe("project runtime state", () => {
  it.effect("returns empty state for missing or invalid runtime metadata", () =>
    withTempDir((projectDir) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const statePath = path.join(projectDir, ...projectRuntimeStateRelativePath)

        const missing = yield* _(readProjectRuntimeState(projectDir))
        expect(missing).toMatchObject({
          lastStartedAtIso: null,
          lastStartedAtEpochMs: null,
          lastStartAction: null,
          lastKnownStatus: "unknown",
          lastAgentSeenAtIso: null,
          lastAgentSeenAtEpochMs: null,
          lastInteractiveSeenAtIso: null,
          lastInteractiveSeenAtEpochMs: null,
          resourceProfile: "normal",
          lastStopReason: null,
          updatedAtIso: null
        })

        yield* _(fs.makeDirectory(path.dirname(statePath), { recursive: true }))
        yield* _(fs.writeFileString(statePath, "{not-json"))

        const invalid = yield* _(readProjectRuntimeState(projectDir))
        expect(invalid).toMatchObject({
          lastStartedAtIso: null,
          lastStartedAtEpochMs: null,
          lastStartAction: null,
          lastKnownStatus: "unknown",
          lastAgentSeenAtIso: null,
          lastAgentSeenAtEpochMs: null,
          lastInteractiveSeenAtIso: null,
          lastInteractiveSeenAtEpochMs: null,
          resourceProfile: "normal",
          lastStopReason: null,
          updatedAtIso: null
        })
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("persists launch time and preserves it across explicit stops", () =>
    withTempDir((projectDir) =>
      Effect.gen(function*(_) {
        const startedAtIso = "2026-04-21T10:00:00.000Z"
        const startedAtEpochMs = Date.parse(startedAtIso)

        const started = yield* _(
          recordProjectRuntimeStarted(projectDir, {
            action: "up",
            startedAtIso,
            startedAtEpochMs
          })
        )

        expect(started).toMatchObject({
          lastStartedAtIso: startedAtIso,
          lastStartedAtEpochMs: startedAtEpochMs,
          lastStartAction: "up",
          lastKnownStatus: "running",
          resourceProfile: "normal",
          lastStopReason: null
        })

        const agentActivity = yield* _(recordProjectRuntimeActivity(projectDir, "agent"))
        expect(agentActivity.lastAgentSeenAtEpochMs).not.toBeNull()

        const throttled = yield* _(recordProjectRuntimeResourceProfile(projectDir, "interactive-idle-throttled"))
        expect(throttled.resourceProfile).toBe("interactive-idle-throttled")

        const agentActivityWhileThrottled = yield* _(recordProjectRuntimeActivity(projectDir, "agent"))
        expect(agentActivityWhileThrottled.lastAgentSeenAtEpochMs).not.toBeNull()
        expect(agentActivityWhileThrottled.resourceProfile).toBe("interactive-idle-throttled")

        const stopped = yield* _(recordProjectRuntimeStopped(projectDir, "auto-suspend"))
        expect(stopped).toMatchObject({
          lastStartedAtIso: startedAtIso,
          lastStartedAtEpochMs: startedAtEpochMs,
          lastStartAction: "up",
          lastKnownStatus: "stopped",
          resourceProfile: "normal",
          lastStopReason: "auto-suspend"
        })
        expect(stopped.lastAgentSeenAtEpochMs).toBe(agentActivityWhileThrottled.lastAgentSeenAtEpochMs)

        const reread = yield* _(readProjectRuntimeState(projectDir))
        expect(reread).toMatchObject(stopped)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
