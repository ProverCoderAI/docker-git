import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, pipe } from "effect"

import { runCli } from "./cli.js"
import { errorMessage } from "./json.js"

// CHANGE: Run the CLI entrypoint through the Effect Node runtime.
// WHY: Establish a controlled SHELL boundary while preserving the existing synchronous CLI behavior.
// QUOTE(ТЗ): "entrypoint через Effect runtime"
// REF: user-request-2026-06-17-effect-compliance-session-sync
// SOURCE: n/a
// FORMAT THEOREM: runCli(args,cwd)=0 -> exitCode unchanged; runCli(args,cwd)=n>0 -> process.exitCode=n; throws(e) -> stderr=e ∧ exitCode=1
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: CLI observable exit code and stderr semantics are preserved.
// COMPLEXITY: O(n)/O(1), where n is delegated CLI work.
const main = pipe(
  Effect.try({
    try: () => runCli(process.argv.slice(2), process.cwd()),
    catch: errorMessage
  }),
  Effect.match({
    onFailure: (message) =>
      Effect.sync(() => {
        process.stderr.write(`${message}\n`)
        process.exitCode = 1
      }),
    onSuccess: (exitCode) =>
      Effect.sync(() => {
        if (exitCode !== 0) {
          process.exitCode = exitCode
        }
      })
  }),
  Effect.flatten,
  Effect.provide(NodeContext.layer)
)

NodeRuntime.runMain(main)
