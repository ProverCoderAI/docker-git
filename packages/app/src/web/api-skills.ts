import { Effect } from "effect"

import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"
import type { ProjectSkillScope } from "./api-schema.js"

const skillScopeIdByScope: Readonly<Record<ProjectSkillScope, string>> = {
  "skills": "skills",
  "agents/skills": "agents-skills",
  "agents/.skills": "agents-dot-skills",
  "claude/skills": "claude-skills",
  "codex/skills": "codex-skills",
  "gemini/skills": "gemini-skills",
  "grok/skills": "grok-skills"
}

export const projectSkillScopeToId = (scope: ProjectSkillScope): string => skillScopeIdByScope[scope]

export const loadProjectSkills = (projectId: string) =>
  dockerGitOpenApi.GET("/projects/{projectId}/skills", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.snapshot),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const writeProjectSkill = (
  projectId: string,
  scope: ProjectSkillScope,
  name: string,
  content: string
) =>
  dockerGitOpenApi.POST("/projects/{projectId}/skills", {
    body: { content, name, scope },
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.snapshot),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const deleteProjectSkill = (
  projectId: string,
  scope: ProjectSkillScope,
  name: string
) =>
  dockerGitOpenApi.DELETE("/projects/{projectId}/skills/{scopeId}/{name}", {
    params: { path: { name, projectId, scopeId: projectSkillScopeToId(scope) } }
  }).pipe(
    Effect.map(({ body }) => body.snapshot),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )
