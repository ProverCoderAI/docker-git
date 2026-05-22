import { Either } from "effect"

import type { ParseError } from "./frontend-lib/core/domain.js"
import {
  type AdvanceCreateFlowHandlers,
  type AdvanceCreateFlowOptions,
  type AdvanceCreateFlowResult,
  type CreateFlowContext,
  type CreateFlowView,
  type CreateModeFlowView,
  type DisplayModeFlowView,
  firstCreateSettingsStepIndex,
  isDisplayModeFlowView,
  type Mutable
} from "./menu-create-flow-types.js"
import { normalizeCreateFlowContext, resolveCreateInputs } from "./menu-create-inputs.js"
import { clampCreateSettingsStep, moveCreateDisplaySettingsStep } from "./menu-create-navigation.js"
import { applyCreateBufferToValues } from "./menu-create-step-apply.js"
import { resolveCreateDisplaySteps, resolveCreateFlowSteps } from "./menu-create-steps.js"
import type { CreateInputs, CreateStep } from "./menu-types.js"

/**
 * Creates the initial repo-url prompt view for the create flow.
 *
 * @pure true
 * @invariant step = 0 and values are empty
 * @complexity O(1)
 */
// CHANGE: expose a deterministic initial create-flow view constructor
// WHY: CLI and browser callers need the same pure starting state
// QUOTE(ТЗ): "fix CodeRabbit review comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall b: initial(b).step = 0
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: initial values contain no committed create inputs
// COMPLEXITY: O(1)
export const createInitialFlowView = (buffer = ""): CreateModeFlowView => ({
  mode: "create",
  step: 0,
  buffer,
  inputError: null,
  values: {}
})

const resolveDisplayFlowStep = (view: CreateFlowView): number => {
  const displaySteps = resolveCreateDisplaySteps()
  if (isDisplayModeFlowView(view)) {
    return clampCreateSettingsStep(view.step, displaySteps.length - 1)
  }
  const flowStep = resolveCreateFlowSteps(view.values)[view.step]
  const displayStep = flowStep === undefined ? -1 : displaySteps.indexOf(flowStep)
  return clampCreateSettingsStep(displayStep === -1 ? view.step : displayStep, displaySteps.length - 1)
}

/**
 * Converts a create-flow view into the browser display-settings projection.
 *
 * @pure true
 * @invariant values are preserved exactly
 * @complexity O(s) where s = number of create steps
 */
// CHANGE: map create-mode progress onto browser display settings
// WHY: display mode keeps all rows visible while preserving committed values
// QUOTE(ТЗ): "fix CodeRabbit review comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall v: display(v).values = v.values
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: display step is clamped to the settings range
// COMPLEXITY: O(s) where s = number of create steps
export const createDisplayFlowView = (view: CreateFlowView): DisplayModeFlowView => ({
  mode: "display",
  step: resolveDisplayFlowStep(view),
  buffer: view.buffer,
  inputError: null,
  values: view.values
})

const shouldQuickCreate = (
  step: CreateStep,
  options: AdvanceCreateFlowOptions
): boolean =>
  step === "repoUrl" &&
  options.quickCreate === true

const continueCreateFlow = (
  nextStep: number,
  nextValues: Partial<Mutable<CreateInputs>>
): AdvanceCreateFlowResult => ({
  _tag: "Continue",
  view: {
    mode: "create",
    step: nextStep,
    buffer: "",
    inputError: null,
    values: nextValues
  }
})

const continueCreateDisplayFlow = (
  view: DisplayModeFlowView,
  nextValues: Partial<Mutable<CreateInputs>>
): AdvanceCreateFlowResult => ({
  _tag: "Continue",
  view: {
    ...view,
    buffer: "",
    inputError: null,
    values: nextValues
  }
})

type ActiveCreateDisplayContext = {
  readonly context: CreateFlowContext
  readonly step: CreateStep
}

const resolveActiveCreateDisplayStep = (view: DisplayModeFlowView): CreateStep | null => {
  const step = resolveCreateDisplaySteps()[view.step]
  return view.step < firstCreateSettingsStepIndex || step === undefined ? null : step
}

const resolveActiveCreateDisplayContext = (
  contextOrCwd: string | CreateFlowContext,
  view: DisplayModeFlowView
): ActiveCreateDisplayContext | null => {
  const step = resolveActiveCreateDisplayStep(view)
  return step === null
    ? null
    : {
      context: normalizeCreateFlowContext(contextOrCwd),
      step
    }
}

const completeCreateFlow = (
  context: CreateFlowContext,
  values: Partial<CreateInputs>
): AdvanceCreateFlowResult => ({
  _tag: "Complete",
  inputs: resolveCreateInputs(context, values)
})

const foldAppliedCreateValues = (
  appliedValues: Either.Either<Partial<Mutable<CreateInputs>>, ParseError>,
  onSuccess: (nextValues: Partial<Mutable<CreateInputs>>) => AdvanceCreateFlowResult
): AdvanceCreateFlowResult =>
  Either.isLeft(appliedValues)
    ? {
      _tag: "Error",
      error: appliedValues.left
    }
    : onSuccess(appliedValues.right)

const withActiveCreateDisplayContext = (
  contextOrCwd: string | CreateFlowContext,
  view: DisplayModeFlowView,
  onActive: (active: ActiveCreateDisplayContext) => AdvanceCreateFlowResult | null
): AdvanceCreateFlowResult | null => {
  const active = resolveActiveCreateDisplayContext(contextOrCwd, view)
  return active === null ? null : onActive(active)
}

/**
 * Applies the current browser display-settings row without moving selection.
 *
 * @pure true
 * @invariant display mode remains display mode on Continue
 * @complexity O(k) where k = number of stored create inputs
 */
// CHANGE: apply browser display settings through the shared pure step applicator
// WHY: display mode must preserve row position while committing one decoded value
// QUOTE(ТЗ): "fix CodeRabbit review comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: active(view) -> result in {Continue, Error}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: inactive rows return null
// COMPLEXITY: O(k) where k = number of stored create inputs
export const applyCreateDisplaySettingsStep = (
  contextOrCwd: string | CreateFlowContext,
  view: DisplayModeFlowView
): AdvanceCreateFlowResult | null =>
  withActiveCreateDisplayContext(contextOrCwd, view, (active) =>
    foldAppliedCreateValues(
      applyCreateBufferToValues(active.context, view, active.step),
      (nextValues) => continueCreateDisplayFlow(view, nextValues)
    ))

/**
 * Applies the current browser display-settings row and advances one row.
 *
 * @pure true
 * @invariant successful application clears the buffer
 * @complexity O(k + s) where s = number of display steps
 */
// CHANGE: compose display setting application with wrapped display navigation
// WHY: Enter in browser settings should commit the row and move to the next editable row
// QUOTE(ТЗ): "fix CodeRabbit review comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: Continue(v) -> step(next(v)) = wrappedSuccessor(v.step)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: errors do not advance selection
// COMPLEXITY: O(k + s) where s = number of display steps
export const advanceCreateDisplaySettingsStep = (
  contextOrCwd: string | CreateFlowContext,
  view: DisplayModeFlowView
): AdvanceCreateFlowResult | null => {
  const applied = applyCreateDisplaySettingsStep(contextOrCwd, view)
  if (applied === null || applied._tag !== "Continue" || !isDisplayModeFlowView(applied.view)) {
    return applied
  }

  const movedView = moveCreateDisplaySettingsStep(applied.view, "down")
  return movedView === null ? applied : { ...applied, view: movedView }
}

/**
 * Completes browser display settings, applying a non-empty active buffer first.
 *
 * @pure true
 * @invariant completion resolves total CreateInputs
 * @complexity O(k) where k = number of stored create inputs
 */
// CHANGE: finish browser settings with optional final-row validation
// WHY: a typed buffer should not be discarded when the user presses Done
// QUOTE(ТЗ): "fix CodeRabbit review comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: complete(view) -> Complete(resolve(values')) or Error
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: invalid active buffers return typed parse errors
// COMPLEXITY: O(k) where k = number of stored create inputs
export const completeCreateDisplaySettingsFlow = (
  contextOrCwd: string | CreateFlowContext,
  view: DisplayModeFlowView
): AdvanceCreateFlowResult | null =>
  withActiveCreateDisplayContext(contextOrCwd, view, (active) => {
    if (view.buffer.trim().length === 0) {
      return completeCreateFlow(active.context, view.values)
    }

    const applied = applyCreateDisplaySettingsStep(active.context, view)
    if (applied === null || applied._tag === "Error") {
      return applied
    }
    if (applied._tag === "Continue") {
      return completeCreateFlow(active.context, applied.view.values)
    }
    return applied
  })

const resolveNextCreateFlowStep = (
  currentStep: CreateStep,
  currentStepIndex: number,
  nextSteps: ReadonlyArray<CreateStep>
): number =>
  currentStep === "repoUrl"
    ? firstCreateSettingsStepIndex
    : clampCreateSettingsStep(currentStepIndex + 1, nextSteps.length - 1)

/**
 * Advances create mode by applying the active prompt buffer.
 *
 * @pure true
 * @invariant non-repo steps advance to the next remaining settings index when continuing
 * @complexity O(k + s) where s = number of remaining create steps
 */
// CHANGE: advance normal create-flow settings after committing the active prompt
// WHY: applying a non-repo step must move forward instead of reselecting the same index
// QUOTE(ТЗ): "after applying a non-repoUrl step it advances to currentStepIndex + 1"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: step != repoUrl -> nextStep = clamp(stepIndex + 1)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: next step is always within the current settings range when continuing
// COMPLEXITY: O(k + s) where s = number of remaining create steps
export const advanceCreateFlow = (
  contextOrCwd: string | CreateFlowContext,
  view: CreateModeFlowView,
  options: AdvanceCreateFlowOptions = {}
): AdvanceCreateFlowResult | null => {
  const context = normalizeCreateFlowContext(contextOrCwd)
  const currentSteps = resolveCreateFlowSteps(view.values)
  const step = currentSteps[view.step]
  if (step === undefined) {
    return null
  }

  return foldAppliedCreateValues(
    applyCreateBufferToValues(context, view, step),
    (nextValues) => {
      if (shouldQuickCreate(step, options)) {
        return completeCreateFlow(context, nextValues)
      }

      const nextSteps = resolveCreateFlowSteps(nextValues)
      const nextStep = resolveNextCreateFlowStep(step, view.step, nextSteps)
      return nextSteps.length > firstCreateSettingsStepIndex && nextStep < nextSteps.length
        ? continueCreateFlow(nextStep, nextValues)
        : completeCreateFlow(context, nextValues)
    }
  )
}

/**
 * Dispatches an advance result to imperative TUI handlers.
 *
 * @pure false
 * @effect AdvanceCreateFlowHandlers
 * @complexity O(1)
 */
// CHANGE: keep create-flow result handling at the shell boundary
// WHY: pure transition results are interpreted by caller-provided side-effect handlers
// QUOTE(ТЗ): "fix CodeRabbit review comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall r: exactly one matching handler is invoked, except null
// PURITY: SHELL
// EFFECT: AdvanceCreateFlowHandlers
// INVARIANT: null results invoke no handler
// COMPLEXITY: O(1)
export const handleAdvanceCreateFlowResult = (
  next: AdvanceCreateFlowResult | null,
  handlers: AdvanceCreateFlowHandlers
): void => {
  if (next === null) {
    return
  }
  if (next._tag === "Error") {
    handlers.onError(next.error)
    return
  }
  if (next._tag === "Continue") {
    handlers.onContinue(next.view)
    return
  }
  handlers.onComplete(next.inputs)
}
