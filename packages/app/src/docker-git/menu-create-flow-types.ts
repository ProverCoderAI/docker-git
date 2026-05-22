import type { ParseError } from "./frontend-lib/core/domain.js"
import type { CreateInputs } from "./menu-types.js"

export type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export type CreateFlowContext = {
  readonly cwd: string
  readonly projectsRoot?: string | undefined
}

type BaseCreateFlowView = {
  readonly buffer: string
  readonly inputError: string | null
  readonly values: Partial<CreateInputs>
}

export type CreateModeFlowView = BaseCreateFlowView & {
  readonly mode: "create"
  readonly step: number
}

export type DisplayModeFlowView = BaseCreateFlowView & {
  readonly mode: "display"
  readonly step: number
}

export type CreateFlowView = CreateModeFlowView | DisplayModeFlowView

export type AdvanceCreateFlowResult =
  | { readonly _tag: "Continue"; readonly view: CreateFlowView }
  | { readonly _tag: "Error"; readonly error: ParseError }
  | { readonly _tag: "Complete"; readonly inputs: CreateInputs }

export type AdvanceCreateFlowHandlers = {
  readonly onComplete: (inputs: CreateInputs) => void
  readonly onContinue: (view: CreateFlowView) => void
  readonly onError: (error: ParseError) => void
}

export type AdvanceCreateFlowOptions = {
  readonly quickCreate?: boolean
}

export type CreateSettingsNavigationDirection = "up" | "down"
export type CreateSettingsChoiceDirection = "left" | "right"

export const createSettingsHint = "↑ - up, ↓ - down, Enter - apply"
export const firstCreateSettingsStepIndex = 1

export const isCreateModeFlowView = (view: CreateFlowView): view is CreateModeFlowView => view.mode === "create"

export const isDisplayModeFlowView = (view: CreateFlowView): view is DisplayModeFlowView => view.mode === "display"

export const isCreateFlowRepoStep = (view: CreateFlowView): boolean => isCreateModeFlowView(view) && view.step === 0
