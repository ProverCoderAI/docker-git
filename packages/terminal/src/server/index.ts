import type { Effect } from "effect"

import type { TerminalSession } from "../contracts/index.js"
import type { TerminalShellCommand } from "../shell/index.js"

export type { TerminalShellCommand } from "../shell/index.js"
export * from "./image-fetch.js"

/**
 * Typed server-side integration boundary for project-backed terminal sessions.
 *
 * @pure false - methods are effectful adapter hooks.
 * @effect TerminalProjectRuntime
 * @invariant project/session effects stay behind this injected interface.
 * @precondition project keys and ids come from validated API routes.
 * @postcondition methods return typed Effect values instead of throwing.
 * @complexity Adapter-defined.
 */
// CHANGE: define a typed server project runtime contract for terminal orchestration.
// WHY: terminal server helpers must not depend on concrete API services.
// QUOTE(ТЗ): "api тоже нужен не один огромный controller, а модульная структура"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: TerminalProjectRuntime = resolveProject × prepareShell × recordActivity × emitEvent
// PURITY: SHELL
// EFFECT: Effect<*, RuntimeError, RuntimeContext>
// INVARIANT: project effects are accessed through this boundary only.
// COMPLEXITY: Adapter-defined/O(1)
export type TerminalProjectRuntime<Project, RuntimeError, RuntimeContext> = {
  readonly emitEvent: (
    projectId: string,
    event: TerminalSessionEvent
  ) => Effect.Effect<void, RuntimeError, RuntimeContext>
  readonly prepareShell: (
    project: Project
  ) => Effect.Effect<TerminalShellCommand, RuntimeError, RuntimeContext>
  readonly recordActivity: (
    projectId: string
  ) => Effect.Effect<void, RuntimeError, RuntimeContext>
  readonly resolveProject: (
    projectKey: string
  ) => Effect.Effect<Project, RuntimeError, RuntimeContext>
}

/**
 * Server-side terminal session event emitted by runtime adapters.
 *
 * @pure true
 * @invariant _tag determines all required event fields.
 * @complexity O(1)
 */
// CHANGE: define terminal session event union in the shared server module.
// WHY: API runtime and future terminal server modules need one event vocabulary.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: event ∈ Created | Ready | Output | Exited | Failed
// PURITY: CORE
// INVARIANT: event union is closed by _tag.
// COMPLEXITY: O(1)/O(1)
export type TerminalSessionEvent =
  | {
    readonly _tag: "Created"
    readonly requestId?: string
    readonly sessionId: string
  }
  | { readonly _tag: "Ready"; readonly session: TerminalSession }
  | {
    readonly _tag: "Output"
    readonly data: string
    readonly sessionId: string
  }
  | {
    readonly _tag: "Exited"
    readonly exitCode: number | null
    readonly sessionId: string
    readonly signal: number | null
  }
  | {
    readonly _tag: "Failed"
    readonly message: string
    readonly sessionId: string
  }
