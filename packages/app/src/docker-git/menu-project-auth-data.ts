import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Match, pipe } from "effect"

import { AuthError } from "@effect-template/lib/shell/errors"
import { ensureEnvFile, findEnvValue, readEnvText, upsertEnvKey } from "@effect-template/lib/usecases/env-file"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"

import { buildLabeledEnvKey, countKeyEntries, normalizeLabel } from "./menu-labeled-env.js"
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
  ProjectClaudeDisconnect: []
}

const resolveCanonicalLabel = (value: string): string => {
  const normalized = normalizeLabel(value)
  return normalized.length === 0 || normalized === "DEFAULT" ? "default" : normalized
}

const githubTokenBaseKey = "GITHUB_TOKEN"
const gitTokenBaseKey = "GIT_AUTH_TOKEN"
const gitUserBaseKey = "GIT_AUTH_USER"
const claudeApiKeyBaseKey = "ANTHROPIC_API_KEY"

const projectGithubLabelKey = "GITHUB_AUTH_LABEL"
const projectGitLabelKey = "GIT_AUTH_LABEL"
const projectClaudeLabelKey = "CLAUDE_AUTH_LABEL"

const defaultGitUser = "x-access-token"

type ProjectAuthEnvText = {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly globalEnvPath: string
  readonly projectEnvPath: string
  readonly globalEnvText: string
  readonly projectEnvText: string
}

const buildGlobalEnvPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/env/global.env`

const loadProjectAuthEnvText = (
  project: ProjectItem
): Effect.Effect<ProjectAuthEnvText, AppError, MenuEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const globalEnvPath = buildGlobalEnvPath(process.cwd())
    yield* _(ensureEnvFile(fs, path, globalEnvPath))
    yield* _(ensureEnvFile(fs, path, project.envProjectPath))
    const globalEnvText = yield* _(readEnvText(fs, globalEnvPath))
    const projectEnvText = yield* _(readEnvText(fs, project.envProjectPath))
    return {
      fs,
      path,
      globalEnvPath,
      projectEnvPath: project.envProjectPath,
      globalEnvText,
      projectEnvText
    }
  })

export const readProjectAuthSnapshot = (
  project: ProjectItem
): Effect.Effect<ProjectAuthSnapshot, AppError, MenuEnv> =>
  pipe(
    loadProjectAuthEnvText(project),
    Effect.map(({ globalEnvPath, globalEnvText, projectEnvPath, projectEnvText }) => ({
      projectDir: project.projectDir,
      projectName: project.displayName,
      envGlobalPath: globalEnvPath,
      envProjectPath: projectEnvPath,
      githubTokenEntries: countKeyEntries(globalEnvText, githubTokenBaseKey),
      gitTokenEntries: countKeyEntries(globalEnvText, gitTokenBaseKey),
      claudeKeyEntries: countKeyEntries(globalEnvText, claudeApiKeyBaseKey),
      activeGithubLabel: findEnvValue(projectEnvText, projectGithubLabelKey),
      activeGitLabel: findEnvValue(projectEnvText, projectGitLabelKey),
      activeClaudeLabel: findEnvValue(projectEnvText, projectClaudeLabelKey)
    }))
  )

const missingSecret = (
  provider: string,
  label: string,
  envPath: string
): AuthError =>
  new AuthError({
    message: `${provider} not connected: label '${label}' not found in ${envPath}`
  })

type ProjectEnvUpdateSpec = {
  readonly rawLabel: string
  readonly canonicalLabel: string
  readonly globalEnvPath: string
  readonly globalEnvText: string
  readonly projectEnvText: string
}

const updateProjectGithubConnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string, AppError> => {
  const key = buildLabeledEnvKey(githubTokenBaseKey, spec.rawLabel)
  const token = findEnvValue(spec.globalEnvText, key)
  if (token === null) {
    return Effect.fail(missingSecret("GitHub token", spec.canonicalLabel, spec.globalEnvPath))
  }
  const withGitToken = upsertEnvKey(spec.projectEnvText, "GIT_AUTH_TOKEN", token)
  const withGhToken = upsertEnvKey(withGitToken, "GH_TOKEN", token)
  const withoutGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, "")
  return Effect.succeed(upsertEnvKey(withoutGitLabel, projectGithubLabelKey, spec.canonicalLabel))
}

const clearProjectGitLabels = (envText: string): string => {
  const withoutGhToken = upsertEnvKey(envText, "GH_TOKEN", "")
  const withoutGitLabel = upsertEnvKey(withoutGhToken, projectGitLabelKey, "")
  return upsertEnvKey(withoutGitLabel, projectGithubLabelKey, "")
}

const updateProjectGithubDisconnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string> => {
  const withoutGitToken = upsertEnvKey(spec.projectEnvText, "GIT_AUTH_TOKEN", "")
  return Effect.succeed(clearProjectGitLabels(withoutGitToken))
}

const updateProjectGitConnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string, AppError> => {
  const tokenKey = buildLabeledEnvKey(gitTokenBaseKey, spec.rawLabel)
  const userKey = buildLabeledEnvKey(gitUserBaseKey, spec.rawLabel)
  const token = findEnvValue(spec.globalEnvText, tokenKey)
  if (token === null) {
    return Effect.fail(missingSecret("Git credentials", spec.canonicalLabel, spec.globalEnvPath))
  }
  const defaultUser = findEnvValue(spec.globalEnvText, gitUserBaseKey) ?? defaultGitUser
  const user = findEnvValue(spec.globalEnvText, userKey) ?? defaultUser
  const withToken = upsertEnvKey(spec.projectEnvText, "GIT_AUTH_TOKEN", token)
  const withUser = upsertEnvKey(withToken, "GIT_AUTH_USER", user)
  const withGhToken = upsertEnvKey(withUser, "GH_TOKEN", token)
  const withGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, spec.canonicalLabel)
  return Effect.succeed(upsertEnvKey(withGitLabel, projectGithubLabelKey, spec.canonicalLabel))
}

const updateProjectGitDisconnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string> => {
  const withoutToken = upsertEnvKey(spec.projectEnvText, "GIT_AUTH_TOKEN", "")
  const withoutUser = upsertEnvKey(withoutToken, "GIT_AUTH_USER", "")
  return Effect.succeed(clearProjectGitLabels(withoutUser))
}

const updateProjectClaudeConnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string, AppError> => {
  const key = buildLabeledEnvKey(claudeApiKeyBaseKey, spec.rawLabel)
  const apiKey = findEnvValue(spec.globalEnvText, key)
  if (apiKey === null) {
    return Effect.fail(missingSecret("Claude key", spec.canonicalLabel, spec.globalEnvPath))
  }
  const withKey = upsertEnvKey(spec.projectEnvText, claudeApiKeyBaseKey, apiKey)
  return Effect.succeed(upsertEnvKey(withKey, projectClaudeLabelKey, spec.canonicalLabel))
}

const updateProjectClaudeDisconnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string> => {
  const withoutKey = upsertEnvKey(spec.projectEnvText, claudeApiKeyBaseKey, "")
  return Effect.succeed(upsertEnvKey(withoutKey, projectClaudeLabelKey, ""))
}

const resolveProjectEnvUpdate = (
  flow: ProjectAuthFlow,
  spec: ProjectEnvUpdateSpec
): Effect.Effect<string, AppError> =>
  Match.value(flow).pipe(
    Match.when("ProjectGithubConnect", () => updateProjectGithubConnect(spec)),
    Match.when("ProjectGithubDisconnect", () => updateProjectGithubDisconnect(spec)),
    Match.when("ProjectGitConnect", () => updateProjectGitConnect(spec)),
    Match.when("ProjectGitDisconnect", () => updateProjectGitDisconnect(spec)),
    Match.when("ProjectClaudeConnect", () => updateProjectClaudeConnect(spec)),
    Match.when("ProjectClaudeDisconnect", () => updateProjectClaudeDisconnect(spec)),
    Match.exhaustive
  )

export const writeProjectAuthFlow = (
  project: ProjectItem,
  flow: ProjectAuthFlow,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, AppError, MenuEnv> =>
  pipe(
    loadProjectAuthEnvText(project),
    Effect.flatMap(({ fs, globalEnvPath, globalEnvText, projectEnvPath, projectEnvText }) => {
      const rawLabel = values["label"] ?? ""
      const canonicalLabel = resolveCanonicalLabel(rawLabel)
      const spec: ProjectEnvUpdateSpec = { rawLabel, canonicalLabel, globalEnvPath, globalEnvText, projectEnvText }
      const nextProjectEnv = resolveProjectEnvUpdate(flow, spec)
      const syncMessage = Match.value(flow).pipe(
        Match.when("ProjectGithubConnect", () => `chore(state): project auth gh ${canonicalLabel} ${project.displayName}`),
        Match.when("ProjectGithubDisconnect", () => `chore(state): project auth gh logout ${project.displayName}`),
        Match.when("ProjectGitConnect", () => `chore(state): project auth git ${canonicalLabel} ${project.displayName}`),
        Match.when("ProjectGitDisconnect", () => `chore(state): project auth git logout ${project.displayName}`),
        Match.when("ProjectClaudeConnect", () => `chore(state): project auth claude ${canonicalLabel} ${project.displayName}`),
        Match.when("ProjectClaudeDisconnect", () => `chore(state): project auth claude logout ${project.displayName}`),
        Match.exhaustive
      )
      return pipe(
        nextProjectEnv,
        Effect.flatMap((nextText) => fs.writeFileString(projectEnvPath, nextText)),
        Effect.zipRight(autoSyncState(syncMessage))
      )
    }),
    Effect.asVoid
  )

export const projectAuthViewSteps = (flow: ProjectAuthFlow): ReadonlyArray<ProjectAuthPromptStep> => flowSteps[flow]

export const projectAuthMenuLabels = (): ReadonlyArray<string> => projectAuthMenuItems.map((item) => item.label)

export const projectAuthMenuActionByIndex = (index: number): ProjectAuthMenuAction | null => {
  const item = projectAuthMenuItems[index]
  return item ? item.action : null
}

export const projectAuthMenuSize = (): number => projectAuthMenuItems.length
