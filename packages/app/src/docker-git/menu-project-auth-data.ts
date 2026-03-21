import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Match, pipe } from "effect"

import { ensureEnvFile, findEnvValue, readEnvText } from "@effect-template/lib/usecases/env-file"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"

import { countAuthAccountEntries } from "./menu-auth-snapshot-builder.js"
import { countKeyEntries, normalizeLabel } from "./menu-labeled-env.js"
import { type ProjectEnvUpdateSpec, resolveProjectEnvUpdate } from "./menu-project-auth-flows.js"
import type { MenuEnv, ProjectAuthFlow, ProjectAuthSnapshot } from "./menu-types.js"

export type ProjectAuthMenuAction = ProjectAuthFlow | "Refresh" | "Back"

type ProjectAuthMenuItem = {
  readonly action: ProjectAuthMenuAction
  readonly label: string
}

export type ProjectAuthPromptStep = {
  readonly key: "label"
  readonly label: string
  readonly required: boolean
  readonly secret: boolean
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
  ProjectGeminiDisconnect: []
}

const resolveCanonicalLabel = (value: string): string => {
  const normalized = normalizeLabel(value)
  return normalized.length === 0 || normalized === "DEFAULT" ? "default" : normalized
}

const githubTokenBaseKey = "GITHUB_TOKEN"
const gitTokenBaseKey = "GIT_AUTH_TOKEN"
const projectGithubLabelKey = "GITHUB_AUTH_LABEL"
const projectGitLabelKey = "GIT_AUTH_LABEL"
const projectClaudeLabelKey = "CLAUDE_AUTH_LABEL"
const projectGeminiLabelKey = "GEMINI_AUTH_LABEL"

type ProjectAuthEnvText = {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly globalEnvPath: string
  readonly projectEnvPath: string
  readonly claudeAuthPath: string
  readonly geminiAuthPath: string
  readonly globalEnvText: string
  readonly projectEnvText: string
}

const buildGlobalEnvPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/env/global.env`
const buildClaudeAuthPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/auth/claude`
const buildGeminiAuthPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/auth/gemini`

const loadProjectAuthEnvText = (
  project: ProjectItem
): Effect.Effect<ProjectAuthEnvText, AppError, MenuEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const globalEnvPath = buildGlobalEnvPath(process.cwd())
    const claudeAuthPath = buildClaudeAuthPath(process.cwd())
    const geminiAuthPath = buildGeminiAuthPath(process.cwd())
    yield* _(ensureEnvFile(fs, path, globalEnvPath))
    yield* _(ensureEnvFile(fs, path, project.envProjectPath))
    const globalEnvText = yield* _(readEnvText(fs, globalEnvPath))
    const projectEnvText = yield* _(readEnvText(fs, project.envProjectPath))
    return {
      fs,
      path,
      globalEnvPath,
      projectEnvPath: project.envProjectPath,
      claudeAuthPath,
      geminiAuthPath,
      globalEnvText,
      projectEnvText
    }
  })

export const readProjectAuthSnapshot = (
  project: ProjectItem
): Effect.Effect<ProjectAuthSnapshot, AppError, MenuEnv> =>
  pipe(
    loadProjectAuthEnvText(project),
    Effect.flatMap(({
      claudeAuthPath,
      fs,
      geminiAuthPath,
      globalEnvPath,
      globalEnvText,
      path,
      projectEnvPath,
      projectEnvText
    }) =>
      countAuthAccountEntries(fs, path, claudeAuthPath, geminiAuthPath).pipe(
        Effect.map(({ claudeAuthEntries, geminiAuthEntries }) => ({
          projectDir: project.projectDir,
          projectName: project.displayName,
          envGlobalPath: globalEnvPath,
          envProjectPath: projectEnvPath,
          claudeAuthPath,
          geminiAuthPath,
          githubTokenEntries: countKeyEntries(globalEnvText, githubTokenBaseKey),
          gitTokenEntries: countKeyEntries(globalEnvText, gitTokenBaseKey),
          claudeAuthEntries,
          geminiAuthEntries,
          activeGithubLabel: findEnvValue(projectEnvText, projectGithubLabelKey),
          activeGitLabel: findEnvValue(projectEnvText, projectGitLabelKey),
          activeClaudeLabel: findEnvValue(projectEnvText, projectClaudeLabelKey),
          activeGeminiLabel: findEnvValue(projectEnvText, projectGeminiLabelKey)
        }))
      )
    )
  )

const resolveSyncMessage = (flow: ProjectAuthFlow, canonicalLabel: string, displayName: string): string =>
  Match.value(flow).pipe(
    Match.when("ProjectGithubConnect", () => `chore(state): project auth gh ${canonicalLabel} ${displayName}`),
    Match.when("ProjectGithubDisconnect", () => `chore(state): project auth gh logout ${displayName}`),
    Match.when("ProjectGitConnect", () => `chore(state): project auth git ${canonicalLabel} ${displayName}`),
    Match.when("ProjectGitDisconnect", () => `chore(state): project auth git logout ${displayName}`),
    Match.when("ProjectClaudeConnect", () => `chore(state): project auth claude ${canonicalLabel} ${displayName}`),
    Match.when("ProjectClaudeDisconnect", () => `chore(state): project auth claude logout ${displayName}`),
    Match.when("ProjectGeminiConnect", () => `chore(state): project auth gemini ${canonicalLabel} ${displayName}`),
    Match.when("ProjectGeminiDisconnect", () => `chore(state): project auth gemini logout ${displayName}`),
    Match.exhaustive
  )

export const writeProjectAuthFlow = (
  project: ProjectItem,
  flow: ProjectAuthFlow,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, AppError, MenuEnv> =>
  pipe(
    loadProjectAuthEnvText(project),
    Effect.flatMap(
      ({ claudeAuthPath, fs, geminiAuthPath, globalEnvPath, globalEnvText, projectEnvPath, projectEnvText }) => {
        const rawLabel = values["label"] ?? ""
        const canonicalLabel = resolveCanonicalLabel(rawLabel)
        const spec: ProjectEnvUpdateSpec = {
          fs,
          rawLabel,
          canonicalLabel,
          globalEnvPath,
          globalEnvText,
          projectEnvText,
          claudeAuthPath,
          geminiAuthPath
        }
        const nextProjectEnv = resolveProjectEnvUpdate(flow, spec)
        const syncMessage = resolveSyncMessage(flow, canonicalLabel, project.displayName)
        return pipe(
          nextProjectEnv,
          Effect.flatMap((nextText) => fs.writeFileString(projectEnvPath, nextText)),
          Effect.zipRight(autoSyncState(syncMessage))
        )
      }
    ),
    Effect.asVoid
  )

export const projectAuthViewSteps = (flow: ProjectAuthFlow): ReadonlyArray<ProjectAuthPromptStep> => flowSteps[flow]

export const projectAuthMenuLabels = (): ReadonlyArray<string> => projectAuthMenuItems.map((item) => item.label)

export const projectAuthMenuActionByIndex = (index: number): ProjectAuthMenuAction | null => {
  const item = projectAuthMenuItems[index]
  return item ? item.action : null
}

export const projectAuthMenuSize = (): number => projectAuthMenuItems.length
