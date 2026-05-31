import { Context, Effect } from "effect"
import { makeTerminalRuntimeBoundaryLayer } from "../runtime-boundary.js"

export type TerminalWebRuntimeService = {
  readonly attach: (sessionId: string) => Effect.Effect<void>
}

/**
 * Browser runtime boundary for terminal UI adapters.
 *
 * @pure false - concrete layers may attach browser terminal UI state.
 * @effect TerminalWebRuntime
 * @invariant web effects are injected through this Context.Tag, never imported by core/contracts.
 * @precondition sessionId identifies an existing terminal session in the host adapter.
 * @postcondition Noop layer preserves observable no-op behavior.
 * @complexity O(1) for Noop; concrete layers define their own cost.
 */
// CHANGE: replace marker boundary with a real Effect web service boundary.
// WHY: enforce FCIS dependency direction through Context.Tag/Layer.
// QUOTE(ТЗ): "Делаем то что говорит rabbit"
// REF: coderabbit-runtime-boundary
// SOURCE: n/a
// FORMAT THEOREM: ∀core: core ∉ Requires<TerminalWebRuntime>
// PURITY: SHELL
// EFFECT: Layer<TerminalWebRuntime, never, never>
// INVARIANT: browser terminal effects are available only through TerminalWebRuntime.
// COMPLEXITY: O(1)/O(1)
export class TerminalWebRuntime extends Context.Tag("TerminalWebRuntime")<
  TerminalWebRuntime,
  TerminalWebRuntimeService
>() {
  static readonly Noop = makeTerminalRuntimeBoundaryLayer(this, {
    attach: () => Effect.void
  })
}

export * from "./panel-terminal-header.js"
export * from "./panel-terminal-mobile-controls.js"
export * from "./panel-terminal-styles.js"
export * from "./panel-terminal-types.js"
export * from "./panel-terminal.js"
export * from "./terminal-copy-interaction.js"
export * from "./terminal-copy-selection-drag.js"
export * from "./terminal-image-paste.js"
export * from "./terminal-image-paths.js"
export * from "./terminal-image-url.js"
export * from "./terminal-inline-images-core.js"
export * from "./terminal-inline-images.js"
export * from "./terminal-mobile-controls.js"
export * from "./terminal-mobile-layout.js"
export * from "./terminal-panel-cleanup-runtime.js"
export * from "./terminal-panel-inline-images-runtime.js"
export * from "./terminal-panel-input.js"
export * from "./terminal-panel-optional-operation.js"
export * from "./terminal-panel-runtime-core.js"
export * from "./terminal-panel-runtime-types.js"
export * from "./terminal-panel-runtime.js"
export * from "./terminal-query-suppression.js"
export * from "./terminal-reconnect.js"
export * from "./terminal-state.js"
export * from "./terminal-wheel-scroll.js"
export * from "./terminal.js"
