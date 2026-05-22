import * as fc from "fast-check"
import { expect } from "vitest"

import { deriveRepoPathParts, resolveRepoInput } from "../../src/docker-git/frontend-lib/core/domain.js"
import {
  advanceCreateFlow,
  createDisplayFlowView,
  type CreateFlowView,
  createInitialFlowView,
  type CreateModeFlowView,
  type DisplayModeFlowView,
  resolveCreateDisplaySteps,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"
import type { CreateStep } from "../../src/docker-git/menu-types.js"

type CreateFlowAdvanceResult = NonNullable<ReturnType<typeof advanceCreateFlow>>

export const featureCreateRepoUrl = "https://github.com/org/repo/tree/feature-x"

const githubNameChars = "abcdefghijklmnopqrstuvwxyz0123456789-"
const githubNameCharArbitrary = fc
  .integer({ min: 0, max: githubNameChars.length - 1 })
  .map((index) => githubNameChars[index] ?? "a")

const githubSegmentArbitrary = fc
  .array(githubNameCharArbitrary, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(""))
  .filter((value) => !value.startsWith("-") && !value.endsWith("-"))

export const repositoryCreateInputArbitrary = fc.record({
  branch: fc.option(githubSegmentArbitrary, { nil: null }),
  owner: githubSegmentArbitrary,
  repo: githubSegmentArbitrary
}).map(({ branch, owner, repo }) => ({
  expectedRepoRef: branch ?? "main",
  repoUrl: branch === null
    ? `https://github.com/${owner}/${repo}`
    : `https://github.com/${owner}/${repo}/tree/${branch}`
}))

/**
 * Resolves the expected create-flow output directory for a generated repo URL.
 *
 * @param repoUrl - Generated GitHub repository URL accepted by create-flow parsing.
 * @param projectsRoot - Browser projects root used as the output directory base.
 * @returns Expected POSIX output directory for the repository.
 * @pure true
 * @effect n/a
 * @invariant Root projectsRoot "/" is preserved as an absolute path prefix.
 * @precondition `repoUrl` and `projectsRoot` are finite strings.
 * @postcondition The result contains the derived repo path parts in order.
 * @complexity O(n) time and O(n) space where n = |repoUrl|.
 * @throws Never
 */
// CHANGE: preserve absolute root projectsRoot in generated create-flow expectations
// WHY: property tests must assert "/" maps to /owner/repo, not //owner/repo
// QUOTE(ТЗ): "Потеря абсолютного корня в joinPath при \"/\""
// REF: CodeRabbit PR #344 review
// SOURCE: n/a
// FORMAT THEOREM: projectsRoot = "/" -> result startsWith "/"
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: root projectsRoot remains absolute
// COMPLEXITY: O(n) where n = |repoUrl|
export const expectedOutDirForRepoUrl = (repoUrl: string, projectsRoot: string): string => {
  const repoPath = deriveRepoPathParts(resolveRepoInput(repoUrl).repoUrl).pathParts.join("/")
  return projectsRoot === "/" ? `/${repoPath}` : `${projectsRoot}/${repoPath}`
}

export const expectCreateContinueView = (
  next: ReturnType<typeof advanceCreateFlow>
): Extract<CreateFlowAdvanceResult, { readonly _tag: "Continue" }>["view"] => {
  expect(next?._tag).toBe("Continue")
  if (next === null || next._tag !== "Continue") {
    throw new TypeError("expected continue create flow result")
  }
  return next.view
}

export const expectCreateCompleteInputs = (
  next: ReturnType<typeof advanceCreateFlow>
): Extract<CreateFlowAdvanceResult, { readonly _tag: "Complete" }>["inputs"] => {
  expect(next?._tag).toBe("Complete")
  if (next === null || next._tag !== "Complete") {
    throw new TypeError("expected complete create flow result")
  }
  return next.inputs
}

export const resolveRequiredCreateStepIndex = (
  stepName: CreateStep,
  steps: ReadonlyArray<CreateStep>
): number => {
  const step = steps.indexOf(stepName)
  if (step === -1) {
    throw new TypeError(`expected Create step: ${stepName}`)
  }
  return step
}

export const expectedWrappedCreateNavigationStep = (
  step: number,
  direction: "up" | "down",
  lastStep: number
): number => {
  if (direction === "up") {
    return step === 1 ? lastStep : step - 1
  }
  return step === lastStep ? 1 : step + 1
}

export const expectCreateNavigationResult = (
  next: CreateFlowView | null,
  expectedStep: number,
  expectedValues: CreateFlowView["values"]
): void => {
  expect(next).not.toBeNull()
  expect(next?.step).toBe(expectedStep)
  expect(next?.buffer).toBe("")
  expect(next?.values).toEqual(expectedValues)
}

export const createFeatureRepoSettingsView = (
  contextOrCwd: Parameters<typeof advanceCreateFlow>[0]
): CreateModeFlowView => {
  const view = expectCreateContinueView(advanceCreateFlow(contextOrCwd, createInitialFlowView(featureCreateRepoUrl)))
  if (view.mode !== "create") {
    throw new TypeError("expected create mode flow view")
  }
  return view
}

export const createFeatureRepoDisplaySettingsView = (
  contextOrCwd: Parameters<typeof advanceCreateFlow>[0]
): DisplayModeFlowView => createDisplayFlowView(createFeatureRepoSettingsView(contextOrCwd))

export function createFlowViewAtStep(
  view: CreateModeFlowView,
  stepName: CreateStep,
  buffer?: string
): CreateModeFlowView
export function createFlowViewAtStep(
  view: DisplayModeFlowView,
  stepName: CreateStep,
  buffer?: string
): DisplayModeFlowView
export function createFlowViewAtStep(
  view: CreateFlowView,
  stepName: CreateStep,
  buffer = "draft"
): CreateFlowView {
  const steps = view.mode === "display"
    ? resolveCreateDisplaySteps()
    : resolveCreateFlowSteps(view.values)
  return {
    ...view,
    buffer,
    step: resolveRequiredCreateStepIndex(stepName, steps)
  }
}
