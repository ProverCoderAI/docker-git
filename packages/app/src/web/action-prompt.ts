import { Match } from "effect"

import { type AuthMenuAction, authViewSteps, authViewTitle } from "../docker-git/menu-auth-shared.js"
import { type ProjectAuthMenuAction, projectAuthViewSteps } from "../docker-git/menu-project-auth-shared.js"

export type ActionPromptStep = {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly secret: boolean
}

type AuthPromptAction = Exclude<AuthMenuAction, "Back" | "Refresh">
type ProjectAuthPromptAction = Exclude<ProjectAuthMenuAction, "Back" | "Refresh">

export type ActionPromptState =
  | {
    readonly action: AuthPromptAction
    readonly kind: "Auth"
    readonly steps: ReadonlyArray<ActionPromptStep>
    readonly title: string
    readonly values: Readonly<Record<string, string>>
  }
  | {
    readonly action: ProjectAuthPromptAction
    readonly kind: "ProjectAuth"
    readonly steps: ReadonlyArray<ActionPromptStep>
    readonly title: string
    readonly values: Readonly<Record<string, string>>
  }

const initialPromptValues = (steps: ReadonlyArray<ActionPromptStep>): Readonly<Record<string, string>> =>
  Object.fromEntries(steps.map((step) => [step.key, ""]))

const projectAuthTitle = (action: ProjectAuthPromptAction): string =>
  Match.value(action).pipe(
    Match.when("ProjectGithubConnect", () => "Project GitHub connect"),
    Match.when("ProjectGithubDisconnect", () => "Project GitHub disconnect"),
    Match.when("ProjectGitConnect", () => "Project Git connect"),
    Match.when("ProjectGitDisconnect", () => "Project Git disconnect"),
    Match.when("ProjectClaudeConnect", () => "Project Claude connect"),
    Match.when("ProjectClaudeDisconnect", () => "Project Claude disconnect"),
    Match.when("ProjectGeminiConnect", () => "Project Gemini connect"),
    Match.when("ProjectGeminiDisconnect", () => "Project Gemini disconnect"),
    Match.when("ProjectGrokConnect", () => "Project Grok connect"),
    Match.when("ProjectGrokDisconnect", () => "Project Grok disconnect"),
    Match.exhaustive
  )

export const createAuthActionPrompt = (action: AuthPromptAction): ActionPromptState => {
  const steps = authViewSteps(action)
  return {
    action,
    kind: "Auth",
    steps,
    title: authViewTitle(action),
    values: initialPromptValues(steps)
  }
}

export const createProjectAuthActionPrompt = (action: ProjectAuthPromptAction): ActionPromptState => {
  const steps = projectAuthViewSteps(action)
  return {
    action,
    kind: "ProjectAuth",
    steps,
    title: projectAuthTitle(action),
    values: initialPromptValues(steps)
  }
}

export const updateActionPromptValue = (
  prompt: ActionPromptState,
  key: string,
  value: string
): ActionPromptState => ({
  ...prompt,
  values: {
    ...prompt.values,
    [key]: value
  }
})

export const validateActionPrompt = (prompt: ActionPromptState): string | null => {
  for (const step of prompt.steps) {
    const value = prompt.values[step.key]?.trim() ?? ""
    if (step.required && value.length === 0) {
      return `${step.label} is required.`
    }
  }
  return null
}
