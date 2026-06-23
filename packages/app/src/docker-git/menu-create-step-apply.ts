import { Either, Match } from "effect"

import type { ParseError } from "./frontend-lib/core/domain.js"
import { isYesDefault, parseGpuInput } from "./menu-create-choices.js"
import { parseRepoStepInput } from "./menu-create-command-parse.js"
import type { CreateFlowContext, CreateFlowView, Mutable } from "./menu-create-flow-types.js"
import { resolveCreateInputs } from "./menu-create-inputs.js"
import type { CreateInputs, CreateStep } from "./menu-types.js"

type ApplyCreateStepInput = {
  readonly step: CreateStep
  readonly buffer: string
  readonly currentDefaults: CreateInputs
  readonly context: CreateFlowContext
}

const applyRepoStep = (
  input: ApplyCreateStepInput
): Either.Either<Partial<Mutable<CreateInputs>>, ParseError> => parseRepoStepInput(input.context, input.buffer)

const applyTextStep = (
  input: ApplyCreateStepInput,
  key: "repoRef" | "outDir" | "cpuLimit" | "ramLimit"
): Either.Either<Partial<Mutable<CreateInputs>>, ParseError> => {
  const value = input.buffer.length > 0 ? input.buffer : input.currentDefaults[key]
  return Match.value(key).pipe(
    Match.when("repoRef", () => Either.right({ repoRef: value })),
    Match.when("outDir", () => Either.right({ outDir: value })),
    Match.when("cpuLimit", () => Either.right({ cpuLimit: value })),
    Match.when("ramLimit", () => Either.right({ ramLimit: value })),
    Match.exhaustive
  )
}

const applyGpuStep = (
  input: ApplyCreateStepInput
): Either.Either<Partial<Mutable<CreateInputs>>, ParseError> => {
  const gpu = parseGpuInput(input.buffer, input.currentDefaults.gpu)
  return Either.isLeft(gpu) ? Either.left(gpu.left) : Either.right({ gpu: gpu.right })
}

const applyBooleanStep = (
  input: ApplyCreateStepInput,
  key: "runUp" | "enableMcpPlaywright" | "enableMcpAndroid" | "force"
): Either.Either<Partial<Mutable<CreateInputs>>, ParseError> => {
  const isValue = isYesDefault(input.buffer, input.currentDefaults[key])
  return Match.value(key).pipe(
    Match.when("runUp", () => Either.right({ runUp: isValue })),
    Match.when("enableMcpPlaywright", () => Either.right({ enableMcpPlaywright: isValue })),
    Match.when("enableMcpAndroid", () => Either.right({ enableMcpAndroid: isValue })),
    Match.when("force", () => Either.right({ force: isValue })),
    Match.exhaustive
  )
}

const applyCreateStep = (
  input: ApplyCreateStepInput
): Either.Either<Partial<Mutable<CreateInputs>>, ParseError> =>
  Match.value(input.step).pipe(
    Match.when("repoUrl", () => applyRepoStep(input)),
    Match.when("repoRef", () => applyTextStep(input, "repoRef")),
    Match.when("outDir", () => applyTextStep(input, "outDir")),
    Match.when("cpuLimit", () => applyTextStep(input, "cpuLimit")),
    Match.when("ramLimit", () => applyTextStep(input, "ramLimit")),
    Match.when("gpu", () => applyGpuStep(input)),
    Match.when("runUp", () => applyBooleanStep(input, "runUp")),
    Match.when("mcpPlaywright", () => applyBooleanStep(input, "enableMcpPlaywright")),
    Match.when("mcpAndroid", () => applyBooleanStep(input, "enableMcpAndroid")),
    Match.when("force", () => applyBooleanStep(input, "force")),
    Match.exhaustive
  )

/**
 * Applies the active create-flow buffer to a fresh partial values object.
 *
 * @pure true
 * @invariant result = previous values plus exactly the decoded active step update
 * @complexity O(k) where k = number of stored create inputs
 */
// CHANGE: apply create-flow step buffers without mutating accumulated values
// WHY: CORE state transitions must be referentially transparent for tests and reviewability
// QUOTE(ТЗ): "return immutable partial updates and merge immutably"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall v,u: apply(v,u) = merge(v, delta(u))
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: input view.values is never mutated
// COMPLEXITY: O(k) where k = number of stored create inputs
export const applyCreateBufferToValues = (
  context: CreateFlowContext,
  view: CreateFlowView,
  step: CreateStep
): Either.Either<Partial<Mutable<CreateInputs>>, ParseError> => {
  const buffer = view.buffer.trim()
  const currentDefaults = resolveCreateInputs(context, view.values)
  const updated = applyCreateStep({
    step,
    buffer,
    currentDefaults,
    context
  })
  return Either.isLeft(updated) ? Either.left(updated.left) : Either.right({ ...view.values, ...updated.right })
}
