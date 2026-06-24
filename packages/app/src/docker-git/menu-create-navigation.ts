import { Match } from "effect"

import type {
  CreateModeFlowView,
  CreateSettingsChoiceDirection,
  CreateSettingsNavigationDirection,
  DisplayModeFlowView
} from "./menu-create-flow-types.js"
import { firstCreateSettingsStepIndex } from "./menu-create-flow-types.js"
import { resolveCreateDisplaySteps, resolveCreateFlowSteps } from "./menu-create-steps.js"

/**
 * Clamps a create settings index into the editable settings range.
 *
 * @param step - Candidate step index.
 * @param lastStep - Inclusive upper bound of the current settings range.
 * @returns `step` bounded to `[firstCreateSettingsStepIndex, lastStep]`.
 * @pure true
 * @effect n/a
 * @invariant result is between first settings step and lastStep when range is valid
 * @precondition `lastStep >= firstCreateSettingsStepIndex` for a non-empty settings range.
 * @postcondition result >= firstCreateSettingsStepIndex and result <= lastStep when the precondition holds.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: centralize create settings index clamping
// WHY: advancement and navigation must share the same range invariant
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall i: clamp(i) in [first,last] for first <= last
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: repo URL step is excluded from the settings range
// COMPLEXITY: O(1)
export const clampCreateSettingsStep = (
  step: number,
  lastStep: number
): number => Math.min(Math.max(step, firstCreateSettingsStepIndex), lastStep)

/**
 * Computes a wrapped adjacent settings index.
 *
 * @param step - Current valid settings step index.
 * @param lastStep - Inclusive upper bound for settings.
 * @param direction - Vertical navigation direction.
 * @returns The previous or next settings index with wraparound.
 * @pure true
 * @effect n/a
 * @invariant result is inside `[firstCreateSettingsStepIndex, lastStep]`.
 * @precondition `step` is inside `[firstCreateSettingsStepIndex, lastStep]`.
 * @postcondition `up` decrements or wraps to `lastStep`; `down` increments or wraps to first settings step.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: isolate wrapped create-settings index arithmetic
// WHY: both create and display modes share the same vertical navigation law
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall s in [first,last], d: next(s,d) in [first,last]
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: navigation never returns the repo URL step
// COMPLEXITY: O(1)
const nextCreateSettingsStep = (
  step: number,
  lastStep: number,
  direction: CreateSettingsNavigationDirection
): number =>
  Match.value(direction).pipe(
    Match.when("up", () => step === firstCreateSettingsStepIndex ? lastStep : step - 1),
    Match.when("down", () => step === lastStep ? firstCreateSettingsStepIndex : step + 1),
    Match.exhaustive
  )

/**
 * Moves any settings-capable create-flow view within a bounded range.
 *
 * @param view - Create or display view to move.
 * @param lastStep - Inclusive upper bound for the active settings list.
 * @param direction - Vertical navigation direction.
 * @returns A moved view, the original view if unchanged, or null when no settings range is active.
 * @pure true
 * @effect n/a
 * @invariant Returned views preserve mode and committed values.
 * @precondition `view` is non-null and `lastStep` belongs to the step list used by the caller.
 * @postcondition Non-null moved views have empty `buffer` and null `inputError`.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: share immutable settings movement across create and display modes
// WHY: the two views differ only in the step list that defines `lastStep`
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: valid(v,last) -> move(v).values = v.values
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: repo URL or empty settings ranges return null
// COMPLEXITY: O(1)
const moveCreateSettingsWithin = <
  A extends CreateModeFlowView | DisplayModeFlowView
>(
  view: A,
  lastStep: number,
  direction: CreateSettingsNavigationDirection
): A | null => {
  if (view.step < firstCreateSettingsStepIndex || lastStep < firstCreateSettingsStepIndex) {
    return null
  }

  const currentStep = clampCreateSettingsStep(view.step, lastStep)
  const step = nextCreateSettingsStep(currentStep, lastStep, direction)
  return step === view.step
    ? view
    : {
      ...view,
      step,
      buffer: "",
      inputError: null
    }
}

/**
 * Resolves a horizontal boolean choice to the create-flow buffer token.
 *
 * @param direction - Horizontal choice direction.
 * @returns `"n"` for left and `"y"` for right.
 * @pure true
 * @effect n/a
 * @invariant result is always a valid yes/no buffer token.
 * @precondition `direction` is a valid CreateSettingsChoiceDirection.
 * @postcondition Left maps to false-preview token; right maps to true-preview token.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: encode boolean left/right choices as create input buffer values
// WHY: preview buffers reuse the same parser path as typed settings input
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: direction in {left,right} -> token in {n,y}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: output token set is finite and parser-compatible
// COMPLEXITY: O(1)
const booleanChoiceBuffer = (direction: CreateSettingsChoiceDirection): string =>
  Match.value(direction).pipe(
    Match.when("left", () => "n"),
    Match.when("right", () => "y"),
    Match.exhaustive
  )

/**
 * Resolves a horizontal GPU choice to the create-flow buffer token.
 *
 * @param direction - Horizontal choice direction.
 * @returns `"none"` for left and `"all"` for right.
 * @pure true
 * @effect n/a
 * @invariant result is always a valid GPU buffer token.
 * @precondition `direction` is a valid CreateSettingsChoiceDirection.
 * @postcondition Left maps to `none`; right maps to `all`.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: encode GPU left/right choices as create input buffer values
// WHY: display controls should use the same parser-compatible token space as manual input
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: direction in {left,right} -> token in {none,all}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: output token set is finite and parser-compatible
// COMPLEXITY: O(1)
const gpuChoiceBuffer = (direction: CreateSettingsChoiceDirection): string =>
  Match.value(direction).pipe(
    Match.when("left", () => "none"),
    Match.when("right", () => "all"),
    Match.exhaustive
  )

/**
 * Resolves horizontal browser setting controls into preview buffer tokens.
 *
 * @param view - Browser display-settings view that provides the active row.
 * @param direction - Horizontal choice direction.
 * @returns A parser-compatible buffer token for discrete rows, otherwise null.
 * @pure true
 * @effect n/a
 * @invariant free-text rows return null
 * @precondition `view.step` may be inside or outside the display step range.
 * @postcondition Returned non-null tokens do not mutate `view.values`.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: map display-mode left/right choices to create setting buffer values
// WHY: browser controls should preview discrete settings without committing values
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall d: choice(d) in BufferToken or null
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: committed view.values are not changed
// COMPLEXITY: O(1)
export const resolveCreateSettingsChoiceBuffer = (
  view: DisplayModeFlowView,
  direction: CreateSettingsChoiceDirection
): string | null => {
  const step = resolveCreateDisplaySteps()[view.step]
  if (step === undefined) {
    return null
  }

  return Match.value(step).pipe(
    Match.when("repoUrl", () => null),
    Match.when("repoRef", () => null),
    Match.when("outDir", () => null),
    Match.when("cpuLimit", () => null),
    Match.when("ramLimit", () => null),
    Match.when("gpu", () => gpuChoiceBuffer(direction)),
    Match.when("runUp", () => booleanChoiceBuffer(direction)),
    Match.when("mcpPlaywright", () => booleanChoiceBuffer(direction)),
    Match.when("mcpAndroid", () => booleanChoiceBuffer(direction)),
    Match.when("force", () => booleanChoiceBuffer(direction)),
    Match.exhaustive
  )
}

/**
 * Moves the create-mode settings selection with wraparound.
 *
 * @param view - Create-mode view to move.
 * @param direction - Vertical navigation direction.
 * @returns Moved create-mode view or null when the repo URL step is active.
 * @pure true
 * @effect n/a
 * @invariant returned view has an empty buffer
 * @precondition `view` is a non-null CreateModeFlowView.
 * @postcondition Non-null result preserves mode and values while clearing transient input state.
 * @complexity O(s) where s = number of remaining create steps
 * @throws Never
 */
// CHANGE: expose pure create-mode settings navigation
// WHY: arrow-key handling must not mutate the current view
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: valid(v) -> step(move(v,d)) = wrapped(step(v),d)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: repo URL step navigation returns null
// COMPLEXITY: O(s) where s = number of remaining create steps
export const moveCreateSettingsStep = (
  view: CreateModeFlowView,
  direction: CreateSettingsNavigationDirection
): CreateModeFlowView | null =>
  moveCreateSettingsWithin(view, resolveCreateFlowSteps(view.values).length - 1, direction)

/**
 * Moves the browser display-settings selection with wraparound.
 *
 * @param view - Display-mode view to move.
 * @param direction - Vertical navigation direction.
 * @returns Moved display-mode view or null when no settings range is active.
 * @pure true
 * @effect n/a
 * @invariant returned view has an empty buffer
 * @precondition `view` is a non-null DisplayModeFlowView.
 * @postcondition Non-null result preserves mode and values while clearing transient input state.
 * @complexity O(s) where s = number of display steps
 * @throws Never
 */
// CHANGE: expose pure display-mode settings navigation
// WHY: browser settings keep all rows navigable regardless of committed values
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: valid(v) -> step(moveDisplay(v,d)) = wrapped(step(v),d)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: display settings never skip applied rows
// COMPLEXITY: O(s) where s = number of display steps
export const moveCreateDisplaySettingsStep = (
  view: DisplayModeFlowView,
  direction: CreateSettingsNavigationDirection
): DisplayModeFlowView | null => moveCreateSettingsWithin(view, resolveCreateDisplaySteps().length - 1, direction)
