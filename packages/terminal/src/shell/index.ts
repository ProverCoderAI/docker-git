import { Context, Effect } from "effect"
import { makeTerminalRuntimeBoundaryLayer } from "../runtime-boundary.js"

/**
 * Host shell command prepared for terminal runtime execution.
 *
 * @pure true
 * @invariant command is required; cwd and env are optional immutable data.
 * @complexity O(1)
 */
// CHANGE: define shell command data at the shell boundary.
// WHY: server contracts can reference command data without owning shell execution.
// QUOTE(ТЗ): "shared domain/usecases/shell для docker-git orchestration"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: TerminalShellCommand = command × cwd? × env?
// PURITY: SHELL
// INVARIANT: command data is immutable at the package boundary.
// COMPLEXITY: O(1)/O(1)
export type TerminalShellCommand = {
  readonly command: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

export type TerminalShellRuntimeService = {
  readonly execute: (command: TerminalShellCommand) => Effect.Effect<void>
}

/**
 * Shell runtime boundary for terminal host commands.
 *
 * @pure false - concrete layers may spawn processes or access host state.
 * @effect TerminalShellRuntime
 * @invariant shell effects are injected through this Context.Tag, never imported by core/contracts.
 * @precondition command.command is a shell command prepared by an adapter/usecase layer.
 * @postcondition Noop layer preserves observable no-op behavior.
 * @complexity O(1) for Noop; concrete layers define their own cost.
 */
// CHANGE: replace marker boundary with a real Effect shell service boundary.
// WHY: enforce FCIS dependency direction through Context.Tag/Layer.
// QUOTE(ТЗ): "Делаем то что говорит rabbit"
// REF: coderabbit-runtime-boundary
// SOURCE: n/a
// FORMAT THEOREM: ∀core: core ∉ Requires<TerminalShellRuntime>
// PURITY: SHELL
// EFFECT: Layer<TerminalShellRuntime, never, never>
// INVARIANT: shell execution is possible only through TerminalShellRuntime.
// COMPLEXITY: O(1)/O(1)
export class TerminalShellRuntime extends Context.Tag("TerminalShellRuntime")<
  TerminalShellRuntime,
  TerminalShellRuntimeService
>() {
  static readonly Noop = makeTerminalRuntimeBoundaryLayer(this, {
    execute: () => Effect.void
  })
}
