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

export const applyCreateDisplaySettingsStep = (
  contextOrCwd: string | CreateFlowContext,
  view: DisplayModeFlowView
): AdvanceCreateFlowResult | null =>
  withActiveCreateDisplayContext(contextOrCwd, view, (active) =>
    foldAppliedCreateValues(
      applyCreateBufferToValues(active.context, view, active.step),
      (nextValues) => continueCreateDisplayFlow(view, nextValues)
    ))

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
    : clampCreateSettingsStep(currentStepIndex, nextSteps.length - 1)

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
