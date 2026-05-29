#!/usr/bin/env bun

import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, pipe } from "effect"

import {
  controllerRevisionForMode,
  parseControllerBuildSkillerMode,
  parseControllerGpuMode
} from "../src/docker-git/controller-compose.ts"
import { computeLocalControllerRevision } from "../src/docker-git/controller-revision.ts"
import { parseControllerDockerRuntime } from "../src/docker-git/controller-runtime.ts"

// CHANGE: expose controller revision computation as a reusable Bun script for shell tooling
// WHY: ctl must inject the same deterministic controller revision into docker compose as the host CLI bootstrap path
// QUOTE(ТЗ): "я не хочу работать со старой версией"
// REF: user-request-2026-04-15-controller-revision-in-ctl
// SOURCE: n/a
// FORMAT THEOREM: ∀p: validComposePath(p) → stdout = computeLocalControllerRevision(p)
// PURITY: SHELL
// EFFECT: Effect<void, Error, NodeContext>
// INVARIANT: successful execution prints exactly one non-empty revision line
// COMPLEXITY: O(total_bytes(inputs))

const usage = "Usage: bun scripts/print-controller-revision.ts <compose-file-path>"

const readComposePath = (): Effect.Effect<string, Error> => {
  const composePath = process.argv[2]?.trim() ?? ""
  return composePath.length > 0
    ? Effect.succeed(composePath)
    : Effect.fail(new Error(usage))
}

const readControllerRevisionModes = (): Effect.Effect<{
  readonly buildSkillerMode: "0" | "1"
  readonly dockerRuntime: "host" | "isolated"
  readonly gpuMode: "none" | "all"
}, Error> => {
  const gpuMode = parseControllerGpuMode(process.env["DOCKER_GIT_CONTROLLER_GPU"])
  const buildSkillerMode = parseControllerBuildSkillerMode(process.env["DOCKER_GIT_CONTROLLER_BUILD_SKILLER"])
  const dockerRuntime = parseControllerDockerRuntime(process.env["DOCKER_GIT_DOCKER_RUNTIME"])
  if (gpuMode === null || buildSkillerMode === null || dockerRuntime === null) {
    return Effect.fail(new Error("Invalid controller revision mode environment."))
  }
  return Effect.succeed({ buildSkillerMode, dockerRuntime, gpuMode })
}

const main = pipe(
  Effect.all({
    composePath: readComposePath(),
    modes: readControllerRevisionModes()
  }),
  Effect.flatMap(({ composePath, modes }) =>
    computeLocalControllerRevision(composePath).pipe(
      Effect.map((revision) =>
        controllerRevisionForMode(revision, modes.gpuMode, modes.buildSkillerMode, modes.dockerRuntime)
      )
    )
  ),
  Effect.tap((revision) => Effect.sync(() => process.stdout.write(`${revision}\n`))),
  Effect.asVoid,
  Effect.provide(NodeContext.layer)
)

NodeRuntime.runMain(main)
