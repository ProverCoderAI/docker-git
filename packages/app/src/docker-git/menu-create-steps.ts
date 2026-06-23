import { Match } from "effect"

import type { CreateInputs, CreateStep } from "./menu-types.js"
import { orderedCreateSteps } from "./menu-types.js"

const hasOwn = (values: Partial<CreateInputs>, key: keyof CreateInputs): boolean =>
  Object.prototype.hasOwnProperty.call(values, key)

const isCreateStepSatisfied = (
  step: CreateStep,
  values: Partial<CreateInputs>
): boolean =>
  Match.value(step).pipe(
    Match.when("repoUrl", () => true),
    Match.when("repoRef", () => true),
    Match.when("outDir", () => true),
    Match.when("cpuLimit", () => hasOwn(values, "cpuLimit")),
    Match.when("ramLimit", () => hasOwn(values, "ramLimit")),
    Match.when("gpu", () => hasOwn(values, "gpu")),
    Match.when("runUp", () => hasOwn(values, "runUp")),
    Match.when("mcpPlaywright", () => hasOwn(values, "enableMcpPlaywright")),
    Match.when("mcpAndroid", () => hasOwn(values, "enableMcpAndroid")),
    Match.when("force", () => hasOwn(values, "force")),
    Match.exhaustive
  )

/**
 * Resolves create-mode prompts that remain after committed values.
 *
 * @pure true
 * @invariant repoUrl is always the first step
 * @complexity O(s) where s = number of create steps
 */
// CHANGE: derive the active create-mode step list from satisfied inputs
// WHY: inline CLI flags and applied settings should remove already-satisfied prompts
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall v: steps(v)[0] = repoUrl
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: only unsatisfied settings remain after repoUrl
// COMPLEXITY: O(s) where s = number of create steps
export const resolveCreateFlowSteps = (
  values: Partial<CreateInputs>
): ReadonlyArray<CreateStep> => [
  "repoUrl",
  ...orderedCreateSteps
    .filter((step) => step !== "repoUrl")
    .filter((step) => !isCreateStepSatisfied(step, values))
]

/**
 * Resolves browser display-settings rows.
 *
 * @pure true
 * @invariant all create steps remain visible
 * @complexity O(1)
 */
// CHANGE: keep browser display settings independent from committed values
// WHY: browser settings must allow revisiting already-applied rows
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall v: displaySteps(v) = orderedCreateSteps
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: display mode never filters satisfied settings
// COMPLEXITY: O(1)
export const resolveCreateDisplaySteps = (
  _values: Partial<CreateInputs> = {}
): ReadonlyArray<CreateStep> => orderedCreateSteps
