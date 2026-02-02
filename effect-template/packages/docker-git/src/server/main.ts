import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

import { program } from "./program.js"

// CHANGE: launch the docker-git web server via NodeRuntime
// WHY: run the HTTP program with platform services and proper shutdown
// QUOTE(ТЗ): "Просто сделай сайт и бекенд приложение"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall env: runMain(program, env) -> server running
// PURITY: SHELL
// EFFECT: Effect<void, ServeError, NodeRuntime>
// INVARIANT: program executed exactly once
// COMPLEXITY: O(1)
NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)))
