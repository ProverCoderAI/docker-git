import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

import { program } from "./program.js"

NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)))
