import { Match } from "effect"

import type { CreateInputs, CreateStep } from "./menu-types.js"
import { createSteps } from "./menu-types.js"

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
    Match.when("force", () => hasOwn(values, "force")),
    Match.exhaustive
  )

export const resolveCreateFlowSteps = (
  values: Partial<CreateInputs>
): ReadonlyArray<CreateStep> => [
  "repoUrl",
  ...createSteps
    .filter((step) => step !== "repoUrl")
    .filter((step) => !isCreateStepSatisfied(step, values))
]

export const resolveCreateDisplaySteps = (
  _values: Partial<CreateInputs> = {}
): ReadonlyArray<CreateStep> => createSteps
