import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, pipe } from "effect"

import { program } from "./program.js"

// CHANGE: add a thin Node runtime entrypoint for the terminal package.
// WHY: follow the effect-template shape and keep runtime provision outside core/contracts.
// QUOTE(ТЗ): "Используй так же модуль"
// REF: issue-361-terminal-package
// SOURCE: https://github.com/ProverCoderAI/effect-template/tree/main/packages/app
// FORMAT THEOREM: main = provide(program, NodeContext)
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: NodeContext is provided only at the package runtime boundary.
// COMPLEXITY: O(1)/O(1)
const main = pipe(program, Effect.provide(NodeContext.layer))

NodeRuntime.runMain(main)
