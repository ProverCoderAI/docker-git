import { Effect } from "effect"

const stateGitLock = Effect.unsafeMakeSemaphore(1)

/**
 * Serializes git operations against the shared `.docker-git` working tree.
 *
 * @param effect - State git operation to run under the process-local lock.
 * @returns The same effect guarded by a single permit semaphore.
 *
 * @pure false
 * @effect Semaphore coordination for state repository shell effects.
 * @invariant At most one guarded state git effect runs in this process.
 * @precondition Effect must not already hold this lock.
 * @postcondition Success/failure value is preserved.
 * @complexity O(effect)
 * @throws Never - failures remain in the Effect error channel.
 */
// CHANGE: serialize state repository git effects
// WHY: inventory auto-pull and create auto-sync can otherwise race on one git working tree
// QUOTE(ТЗ): "project not synchronized"
// REF: issue-372
// SOURCE: https://github.com/ProverCoderAI/docker-git/issues/372
// FORMAT THEOREM: forall a,b in StateGitOps: overlap(guard(a), guard(b)) = false
// PURITY: SHELL
// EFFECT: Effect<A, E, R>
// INVARIANT: a single process-local permit protects the shared state repo
// COMPLEXITY: O(effect)
export const withStateGitLock = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => effect.pipe(stateGitLock.withPermits(1))
