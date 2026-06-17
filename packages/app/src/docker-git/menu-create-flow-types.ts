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

export const settingsHint = "↑ - up, ↓ - down, Enter - apply"
export const firstCreateSettingsStepIndex = 1

/**
 * Narrows a create-flow view to interactive create mode.
 *
 * @param view - Create-flow view to refine.
 * @returns True when `view` is a create-mode view.
 * @pure true
 * @effect n/a
 * @invariant result <=> view.mode = "create"
 * @precondition `view` is a non-null CreateFlowView value.
 * @postcondition True narrows `view` to CreateModeFlowView; false leaves it as the remaining union member.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: expose a pure predicate for create-mode flow views
// WHY: callers need type-safe mode refinement before create-only transitions
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall v: isCreate(v) <-> v.mode = create
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: predicate does not inspect mutable state
// COMPLEXITY: O(1)
export const isCreateModeFlowView = (view: CreateFlowView): view is CreateModeFlowView => view.mode === "create"

/**
 * Narrows a create-flow view to browser display-settings mode.
 *
 * @param view - Create-flow view to refine.
 * @returns True when `view` is a display-mode view.
 * @pure true
 * @effect n/a
 * @invariant result <=> view.mode = "display"
 * @precondition `view` is a non-null CreateFlowView value.
 * @postcondition True narrows `view` to DisplayModeFlowView; false leaves it as the remaining union member.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: expose a pure predicate for display-mode flow views
// WHY: callers need type-safe mode refinement before display-only transitions
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall v: isDisplay(v) <-> v.mode = display
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: predicate does not inspect mutable state
// COMPLEXITY: O(1)
export const isDisplayModeFlowView = (view: CreateFlowView): view is DisplayModeFlowView => view.mode === "display"

/**
 * Detects the repo-url prompt in create mode.
 *
 * @param view - Create-flow view to inspect.
 * @returns True when `view` is create mode at step zero.
 * @pure true
 * @effect n/a
 * @invariant result <=> view.mode = "create" and view.step = 0
 * @precondition `view` is a non-null CreateFlowView value.
 * @postcondition True implies callers may treat the active row as the repo-url prompt.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: expose the repo-step predicate for shared create-flow input handling
// WHY: navigation and input logic treat repo URL entry differently from settings rows
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall v: repoStep(v) -> v.mode = create and v.step = 0
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: display-mode views are never repo-step views
// COMPLEXITY: O(1)
export const isCreateFlowRepoStep = (view: CreateFlowView): boolean => isCreateModeFlowView(view) && view.step === 0
