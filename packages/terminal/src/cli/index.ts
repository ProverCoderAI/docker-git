import { Context, Effect } from "effect"
import { makeTerminalRuntimeBoundaryLayer } from "../runtime-boundary.js"

export type TerminalCliRuntimeService = {
  readonly run: (args: ReadonlyArray<string>) => Effect.Effect<void>
}

/**
 * CLI runtime boundary for terminal commands.
 *
 * @pure false - service methods may run host CLI effects in concrete layers.
 * @effect TerminalCliRuntime
 * @invariant CLI effects are injected through this Context.Tag, never imported by core/contracts.
 * @precondition args is an immutable argv slice supplied by the host CLI shell.
 * @postcondition Noop layer preserves observable no-op behavior.
 * @complexity O(1) for Noop; concrete layers define their own cost.
 */
// CHANGE: replace marker boundary with a real Effect service boundary.
// WHY: satisfy FCIS by making CLI effects injectable through Context.Tag/Layer.
// QUOTE(ТЗ): "Делаем то что говорит rabbit"
// REF: coderabbit-runtime-boundary
// SOURCE: n/a
// FORMAT THEOREM: ∀core: core ∉ Requires<TerminalCliRuntime>
// PURITY: SHELL
// EFFECT: Layer<TerminalCliRuntime, never, never>
// INVARIANT: CLI runtime is available only by providing TerminalCliRuntime.
// COMPLEXITY: O(1)/O(1)
export class TerminalCliRuntime extends Context.Tag("TerminalCliRuntime")<
  TerminalCliRuntime,
  TerminalCliRuntimeService
>() {
  static readonly Noop = makeTerminalRuntimeBoundaryLayer(this, {
    run: () => Effect.void
  })
}
