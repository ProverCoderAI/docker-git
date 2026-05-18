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
  resolveCreateDisplaySteps
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

export const expectedOutDirForRepoUrl = (repoUrl: string): string =>
  `/home/dev/.docker-git/${deriveRepoPathParts(resolveRepoInput(repoUrl).repoUrl).pathParts.join("/")}`

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

export const resolveRequiredCreateStepIndex = (stepName: CreateStep): number => {
  const step = resolveCreateDisplaySteps().indexOf(stepName)
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
  return {
    ...view,
    buffer,
    step: resolveRequiredCreateStepIndex(stepName)
  }
}
