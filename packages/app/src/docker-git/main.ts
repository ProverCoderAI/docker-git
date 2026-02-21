#!/usr/bin/env node

import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

import { program } from "./program.js"

// CHANGE: run docker-git CLI through the Node runtime
// WHY: ensure platform services (FS, Path, Command) are available in app CLI
// QUOTE(ТЗ): "CLI (отображение, фронт) это app"
// REF: user-request-2026-01-28-cli-move
// SOURCE: n/a
// FORMAT THEOREM: forall env: runMain(program, env) -> exit
// PURITY: SHELL
// EFFECT: Effect<void, unknown, NodeContext>
// INVARIANT: program runs with NodeContext.layer
// COMPLEXITY: O(n)
const main = Effect.provide(program, NodeContext.layer)

NodeRuntime.runMain(main)
