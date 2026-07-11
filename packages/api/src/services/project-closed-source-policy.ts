import { type ProjectSourceState, shouldDeleteForSourceState } from "@effect-template/lib"

// CHANGE: decide whether a project whose issue/PR is closed may be auto-deleted
// WHY: deletion is destructive, so it must never race with active work
// QUOTE(ТЗ): "Сделать возможность автоматического удаления контейнера issues или PR которого уже закрылся"
// REF: issue-117
// SOURCE: https://github.com/ProverCoderAI/docker-git/issues/117
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: Delete is returned only when the source is closed and no work is in progress
// COMPLEXITY: O(1)

export type ProjectClosedSourcePolicyInput = {
  readonly sourceState: ProjectSourceState
  readonly hasActiveAgent: boolean
  readonly hasLiveInteractiveSession: boolean
}

export type ProjectClosedSourceDecision =
  | { readonly _tag: "Keep"; readonly reason: "source-open-or-unknown" | "active-agent" | "live-interactive-session" }
  | { readonly _tag: "Delete" }

/**
 * Decide whether a project should be deleted because its issue/PR is closed.
 *
 * A project is deleted only when all of the following hold:
 *  - its originating issue or pull request is definitively `closed`,
 *  - no agent is currently working inside it, and
 *  - no live interactive session (terminal/browser/skiller/ssh) is attached.
 *
 * Anything else keeps the project, with a reason explaining why.
 *
 * @pure true
 * @invariant result._tag = "Delete" → input.sourceState = "closed" ∧ ¬hasActiveAgent ∧ ¬hasLiveInteractiveSession
 * @complexity O(1)
 */
export const decideProjectClosedSourceAction = (
  input: ProjectClosedSourcePolicyInput
): ProjectClosedSourceDecision => {
  if (!shouldDeleteForSourceState(input.sourceState)) {
    return { _tag: "Keep", reason: "source-open-or-unknown" }
  }
  if (input.hasActiveAgent) {
    return { _tag: "Keep", reason: "active-agent" }
  }
  if (input.hasLiveInteractiveSession) {
    return { _tag: "Keep", reason: "live-interactive-session" }
  }
  return { _tag: "Delete" }
}
