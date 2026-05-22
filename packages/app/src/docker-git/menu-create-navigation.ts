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
 * @pure true
 * @invariant result is between first settings step and lastStep when range is valid
 * @complexity O(1)
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

const booleanChoiceBuffer = (direction: CreateSettingsChoiceDirection): string =>
  Match.value(direction).pipe(
    Match.when("left", () => "n"),
    Match.when("right", () => "y"),
    Match.exhaustive
  )

const gpuChoiceBuffer = (direction: CreateSettingsChoiceDirection): string =>
  Match.value(direction).pipe(
    Match.when("left", () => "none"),
    Match.when("right", () => "all"),
    Match.exhaustive
  )

/**
 * Resolves horizontal browser setting controls into preview buffer tokens.
 *
 * @pure true
 * @invariant free-text rows return null
 * @complexity O(1)
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
    Match.when("force", () => booleanChoiceBuffer(direction)),
    Match.exhaustive
  )
}

/**
 * Moves the create-mode settings selection with wraparound.
 *
 * @pure true
 * @invariant returned view has an empty buffer
 * @complexity O(s) where s = number of remaining create steps
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
 * @pure true
 * @invariant returned view has an empty buffer
 * @complexity O(s) where s = number of display steps
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
