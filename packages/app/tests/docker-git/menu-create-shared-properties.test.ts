import { Match } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import { advanceCreateFlow, resolveCreateFlowSteps } from "../../src/docker-git/menu-create-shared.js"
import type { CreateInputs, CreateStep } from "../../src/docker-git/menu-types.js"
import { featureCreateRepoUrl } from "./create-flow-test-helpers.js"

type CreateSettingStep = Exclude<CreateStep, "outDir" | "repoRef" | "repoUrl">

const settingsStepArbitrary: fc.Arbitrary<CreateSettingStep> = fc.constantFrom(
  "cpuLimit",
  "ramLimit",
  "gpu",
  "runUp",
  "mcpPlaywright",
  "force"
)

const stepBufferByStep: Readonly<Record<CreateSettingStep, string>> = {
  cpuLimit: "25%",
  force: "y",
  gpu: "all",
  mcpPlaywright: "n",
  ramLimit: "4g",
  runUp: "y"
}

const satisfiedCreateSettingsArbitrary = fc.uniqueArray(settingsStepArbitrary, {
  maxLength: 6
})

/**
 * Creates the committed value fragment for a satisfied create setting.
 *
 * @param step - Setting step to mark as already satisfied.
 * @returns Partial create inputs containing the setting value.
 * @pure true
 * @effect n/a
 * @invariant Returned fragment satisfies exactly one setting prompt.
 * @precondition `step` is a create setting step.
 * @postcondition `resolveCreateFlowSteps` will not require the returned setting.
 * @complexity O(1) time and O(1) space.
 * @throws Never
 */
// CHANGE: model generated satisfied create settings as immutable input fragments
// WHY: property tests need arbitrary remaining-step shapes without mutating fixtures
// QUOTE(ТЗ): "property-based tests ... no skipped steps"
// REF: CodeRabbit PR #344 review
// SOURCE: n/a
// FORMAT THEOREM: forall step: fragment(step) satisfies step
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: one generated fragment maps to one setting field
// COMPLEXITY: O(1)
const createSatisfiedStepValue = (step: CreateSettingStep): Partial<CreateInputs> =>
  Match.value(step).pipe(
    Match.when("cpuLimit", (): Partial<CreateInputs> => ({ cpuLimit: "20%" })),
    Match.when("ramLimit", (): Partial<CreateInputs> => ({ ramLimit: "2g" })),
    Match.when("gpu", (): Partial<CreateInputs> => ({ gpu: "none" })),
    Match.when("runUp", (): Partial<CreateInputs> => ({ runUp: true })),
    Match.when("mcpPlaywright", (): Partial<CreateInputs> => ({ enableMcpPlaywright: false })),
    Match.when("force", (): Partial<CreateInputs> => ({ force: false })),
    Match.exhaustive
  )

/**
 * Builds create-flow values with a generated set of already-satisfied settings.
 *
 * @param satisfiedSteps - Settings to remove from the remaining prompt list.
 * @param defaultRoot - Deterministic output directory fixture.
 * @returns Partial create inputs with base repo identity and generated satisfied settings.
 * @pure true
 * @effect n/a
 * @invariant Returned values always include repoUrl, repoRef, and outDir.
 * @precondition `defaultRoot` is a finite path fixture.
 * @postcondition Every generated satisfied step is absent from the remaining settings prompts.
 * @complexity O(s) time and O(s) space where s = |satisfiedSteps|.
 * @throws Never
 */
// CHANGE: compose generated satisfied setting fragments for create-flow properties
// WHY: the no-skip invariant must hold for arbitrary remaining prompt sets
// QUOTE(ТЗ): "remaining-steps generated"
// REF: CodeRabbit PR #344 review
// SOURCE: n/a
// FORMAT THEOREM: forall s in satisfiedSteps: s notin remaining(values)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: base repo identity fields are always present
// COMPLEXITY: O(s) where s = |satisfiedSteps|
const createValuesWithSatisfiedSettings = (
  satisfiedSteps: ReadonlyArray<CreateSettingStep>,
  defaultRoot: string
): Partial<CreateInputs> => {
  let values: Partial<CreateInputs> = {
    outDir: defaultRoot,
    repoRef: "feature-x",
    repoUrl: featureCreateRepoUrl
  }
  for (const step of satisfiedSteps) {
    values = {
      ...values,
      ...createSatisfiedStepValue(step)
    }
  }
  return values
}

describe("menu-create-shared property invariants", () => {
  const cwd = process.cwd()
  const defaultRoot = `${process.env["HOME"] ?? cwd}/.docker-git/org/repo`

  it("preserves the next remaining settings index after applying generated current settings", () => {
    fc.assert(
      fc.property(settingsStepArbitrary, satisfiedCreateSettingsArbitrary, (currentStep, satisfiedSteps) => {
        const values = createValuesWithSatisfiedSettings(
          satisfiedSteps.filter((satisfiedStep) => satisfiedStep !== currentStep),
          defaultRoot
        )
        const currentSteps = resolveCreateFlowSteps(values)
        const currentStepIndex = currentSteps.indexOf(currentStep)
        expect(currentStepIndex).toBeGreaterThanOrEqual(1)

        const next = advanceCreateFlow(
          cwd,
          {
            buffer: stepBufferByStep[currentStep],
            inputError: null,
            mode: "create",
            step: currentStepIndex,
            values
          }
        )

        if (next?._tag !== "Continue") {
          expect(next?._tag).toBe("Complete")
          return
        }

        const nextSteps = resolveCreateFlowSteps(next.view.values)
        expect(next.view.step).toBe(currentStepIndex)
        expect(nextSteps[next.view.step]).toBe(nextSteps[currentStepIndex])
      }),
      { numRuns: 75 }
    )
  })
})
