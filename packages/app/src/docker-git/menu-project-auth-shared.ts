import { Match } from "effect"

import type { ProjectAuthFlow } from "./menu-types.js"

export type ProjectAuthMenuAction = ProjectAuthFlow | "Refresh" | "Back"

export type ProjectAuthPromptStep = {
  readonly key: "label"
  readonly label: string
  readonly required: boolean
  readonly secret: boolean
}

type ProjectAuthMenuItem = {
  readonly action: ProjectAuthMenuAction
  readonly label: string
}

const projectAuthMenuItems: ReadonlyArray<ProjectAuthMenuItem> = [
  { action: "ProjectGithubConnect", label: "Project: GitHub connect label" },
  { action: "ProjectGithubDisconnect", label: "Project: GitHub disconnect" },
  { action: "ProjectGitConnect", label: "Project: Git connect label" },
  { action: "ProjectGitDisconnect", label: "Project: Git disconnect" },
  { action: "ProjectClaudeConnect", label: "Project: Claude connect label" },
  { action: "ProjectClaudeDisconnect", label: "Project: Claude disconnect" },
  { action: "ProjectGeminiConnect", label: "Project: Gemini connect label" },
  { action: "ProjectGeminiDisconnect", label: "Project: Gemini disconnect" },
  { action: "ProjectGrokConnect", label: "Project: Grok connect label" },
  { action: "ProjectGrokDisconnect", label: "Project: Grok disconnect" },
  { action: "Refresh", label: "Refresh snapshot" },
  { action: "Back", label: "Back to main menu" }
]

const flowSteps: Readonly<Record<ProjectAuthFlow, ReadonlyArray<ProjectAuthPromptStep>>> = {
  ProjectGithubConnect: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false }
  ],
  ProjectGithubDisconnect: [],
  ProjectGitConnect: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false }
  ],
  ProjectGitDisconnect: [],
  ProjectClaudeConnect: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false }
  ],
  ProjectClaudeDisconnect: [],
  ProjectGeminiConnect: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false }
  ],
  ProjectGeminiDisconnect: [],
  ProjectGrokConnect: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false }
  ],
  ProjectGrokDisconnect: []
}

export const projectAuthSuccessMessage = (
  flow: ProjectAuthFlow,
  label: string
): string =>
  Match.value(flow).pipe(
    Match.when("ProjectGithubConnect", () => `Connected GitHub label (${label}) to project.`),
    Match.when("ProjectGithubDisconnect", () => "Disconnected GitHub from project."),
    Match.when("ProjectGitConnect", () => `Connected Git label (${label}) to project.`),
    Match.when("ProjectGitDisconnect", () => "Disconnected Git from project."),
    Match.when("ProjectClaudeConnect", () => `Connected Claude label (${label}) to project.`),
    Match.when("ProjectClaudeDisconnect", () => "Disconnected Claude from project."),
    Match.when("ProjectGeminiConnect", () => `Connected Gemini label (${label}) to project.`),
    Match.when("ProjectGeminiDisconnect", () => "Disconnected Gemini from project."),
    Match.when("ProjectGrokConnect", () => `Connected Grok label (${label}) to project.`),
    Match.when("ProjectGrokDisconnect", () => "Disconnected Grok from project."),
    Match.exhaustive
  )

export const projectAuthViewSteps = (flow: ProjectAuthFlow): ReadonlyArray<ProjectAuthPromptStep> => flowSteps[flow]

export const projectAuthMenuLabels = (): ReadonlyArray<string> => projectAuthMenuItems.map((item) => item.label)

export const projectAuthMenuActionByIndex = (index: number): ProjectAuthMenuAction | null => {
  const item = projectAuthMenuItems[index]
  return item ? item.action : null
}

export const projectAuthMenuSize = (): number => projectAuthMenuItems.length
