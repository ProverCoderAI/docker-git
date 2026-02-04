import { Effect } from "effect"
import { NodeContext } from "@effect/platform-node"

// CHANGE: run Effect programs with the Node platform layer
// WHY: Next.js API routes need Node FileSystem/CommandExecutor services
// QUOTE(ТЗ): "нам надо что бы он работал как наш docker-git CLI"
// REF: user-request-2026-02-03-web-ui
// SOURCE: n/a
// FORMAT THEOREM: forall e: run(e) -> Promise(result(e))
// PURITY: SHELL
// EFFECT: Effect<Promise<A>, never, NodeContext>
// INVARIANT: NodeContext.layer is always provided
// COMPLEXITY: O(1)
export const runEffect = <A, E>(effect: Effect.Effect<A, E, NodeContext.NodeContext>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, NodeContext.layer))
