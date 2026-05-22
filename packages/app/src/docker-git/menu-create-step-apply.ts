import { Either, Match } from "effect"

import type { ParseError } from "./frontend-lib/core/domain.js"
import { parseGpuInput, parseYesDefault } from "./menu-create-choices.js"
import { parseRepoStepInput } from "./menu-create-command-parse.js"
import type { CreateFlowContext, CreateFlowView, Mutable } from "./menu-create-flow-types.js"
import { resolveCreateInputs } from "./menu-create-inputs.js"
import type { CreateInputs, CreateStep } from "./menu-types.js"

type ApplyCreateStepInput = {
  readonly step: CreateStep
  readonly buffer: string
  readonly currentDefaults: CreateInputs
  readonly nextValues: Partial<Mutable<CreateInputs>>
  readonly context: CreateFlowContext
}

const createStepApplied = (): Either.Either<true, ParseError> => {
  const applied = true
  return Either.right(applied)
}

const applyRepoStep = (input: ApplyCreateStepInput): Either.Either<true, ParseError> => {
  const parsed = parseRepoStepInput(input.context, input.buffer)
  if (Either.isLeft(parsed)) {
    return Either.left(parsed.left)
  }
  Object.assign(input.nextValues, parsed.right)
  return createStepApplied()
}

const applyTextStep = (
  input: ApplyCreateStepInput,
  key: "repoRef" | "outDir" | "cpuLimit" | "ramLimit"
): Either.Either<true, ParseError> => {
  input.nextValues[key] = input.buffer.length > 0 ? input.buffer : input.currentDefaults[key]
  return createStepApplied()
}

const applyGpuStep = (input: ApplyCreateStepInput): Either.Either<true, ParseError> => {
  const gpu = parseGpuInput(input.buffer, input.currentDefaults.gpu)
  if (Either.isLeft(gpu)) {
    return Either.left(gpu.left)
  }
  input.nextValues.gpu = gpu.right
  return createStepApplied()
}

const applyBooleanStep = (
  input: ApplyCreateStepInput,
  key: "runUp" | "enableMcpPlaywright" | "force"
): Either.Either<true, ParseError> => {
  input.nextValues[key] = parseYesDefault(input.buffer, input.currentDefaults[key])
  return createStepApplied()
}

const applyCreateStep = (input: ApplyCreateStepInput): Either.Either<true, ParseError> =>
  Match.value(input.step).pipe(
    Match.when("repoUrl", () => applyRepoStep(input)),
    Match.when("repoRef", () => applyTextStep(input, "repoRef")),
    Match.when("outDir", () => applyTextStep(input, "outDir")),
    Match.when("cpuLimit", () => applyTextStep(input, "cpuLimit")),
    Match.when("ramLimit", () => applyTextStep(input, "ramLimit")),
    Match.when("gpu", () => applyGpuStep(input)),
    Match.when("runUp", () => applyBooleanStep(input, "runUp")),
    Match.when("mcpPlaywright", () => applyBooleanStep(input, "enableMcpPlaywright")),
    Match.when("force", () => applyBooleanStep(input, "force")),
    Match.exhaustive
  )

export const applyCreateBufferToValues = (
  context: CreateFlowContext,
  view: CreateFlowView,
  step: CreateStep
): Either.Either<Partial<Mutable<CreateInputs>>, ParseError> => {
  const buffer = view.buffer.trim()
  const currentDefaults = resolveCreateInputs(context, view.values)
  const nextValues: Partial<Mutable<CreateInputs>> = { ...view.values }
  const updated = applyCreateStep({
    step,
    buffer,
    currentDefaults,
    nextValues,
    context
  })
  return Either.isLeft(updated) ? Either.left(updated.left) : Either.right(nextValues)
}
