import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, pipe } from "effect"

import { program } from "./program.js"

// CHANGE: run the program through the Node platform runtime with its layer
// WHY: ensure effects execute under the platform runtime with proper teardown/logging behavior
// QUOTE(TZ): "\u0414\u0430 \u0434\u0430\u0432\u0430\u0439 \u0442\u0430\u043a \u044d\u0442\u043e \u0431\u043e\u043b\u0435\u0435 \u043f\u0440\u0430\u0432\u0438\u043b\u044c\u043d\u0430\u044f \u0440\u0435\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f"
// REF: user-2025-12-19-platform-node
// SOURCE: https://effect.website/docs/platform/runtime/ "runMain helps you execute a main effect with built-in error handling, logging, and signal management."
// FORMAT THEOREM: forall args in Argv: decode(args) = v -> runMain(program)
// PURITY: SHELL
// EFFECT: Effect<string, S.ParseError, Console>
// INVARIANT: program executed with NodeContext.layer
// COMPLEXITY: O(1)/O(1)
const main = pipe(program, Effect.provide(NodeContext.layer))

NodeRuntime.runMain(main)
