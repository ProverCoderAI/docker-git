import { Match } from "effect"

import type {
  CreateModeFlowView,
  CreateSettingsChoiceDirection,
  CreateSettingsNavigationDirection,
  DisplayModeFlowView
} from "./menu-create-flow-types.js"
import { firstCreateSettingsStepIndex } from "./menu-create-flow-types.js"
import { resolveCreateDisplaySteps, resolveCreateFlowSteps } from "./menu-create-steps.js"

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

export const moveCreateSettingsStep = (
  view: CreateModeFlowView,
  direction: CreateSettingsNavigationDirection
): CreateModeFlowView | null =>
  moveCreateSettingsWithin(view, resolveCreateFlowSteps(view.values).length - 1, direction)

export const moveCreateDisplaySettingsStep = (
  view: DisplayModeFlowView,
  direction: CreateSettingsNavigationDirection
): DisplayModeFlowView | null => moveCreateSettingsWithin(view, resolveCreateDisplaySteps().length - 1, direction)
