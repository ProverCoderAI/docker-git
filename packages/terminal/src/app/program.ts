import { Effect } from "effect"

// CHANGE: define a reusable terminal package program entrypoint.
// WHY: mirror effect-template's thin app/program composition while keeping library exports as the primary surface.
// QUOTE(ТЗ): "Используй так же модуль: https://github.com/ProverCoderAI/effect-template/tree/main/packages/app"
// REF: issue-361-terminal-package
// SOURCE: https://github.com/ProverCoderAI/effect-template/tree/main/packages/app
// FORMAT THEOREM: run(program) -> no_op
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: terminal package entrypoint has no side effects until a concrete adapter composes it.
// COMPLEXITY: O(1)/O(1)
export const program = Effect.void
