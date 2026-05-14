import { type AuthMenuAction, authViewSteps, authViewTitle } from "./auth-flow.js"
import { type ProjectAuthMenuAction, projectAuthViewSteps } from "./project-auth-flow.js"

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

const projectAuthTitle = (action: ProjectAuthPromptAction): string => {
  if (action === "ProjectGithubConnect") {
    return "Project GitHub connect"
  }
  if (action === "ProjectGithubDisconnect") {
    return "Project GitHub disconnect"
  }
  if (action === "ProjectGitConnect") {
    return "Project Git connect"
  }
  if (action === "ProjectGitDisconnect") {
    return "Project Git disconnect"
  }
  if (action === "ProjectClaudeConnect") {
    return "Project Claude connect"
  }
  if (action === "ProjectClaudeDisconnect") {
    return "Project Claude disconnect"
  }
  if (action === "ProjectGeminiConnect") {
    return "Project Gemini connect"
  }
  return "Project Gemini disconnect"
}

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
