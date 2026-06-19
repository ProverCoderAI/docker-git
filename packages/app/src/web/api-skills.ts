import { Effect } from "effect"

import { ProjectSkillsResponseSchema, ProjectSkillUpdateResponseSchema } from "./api-schema.js"
import type { ProjectSkillScope } from "./api-schema.js"
import { openApiJsonSchema } from "./openapi-client.js"

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
  openApiJsonSchema(ProjectSkillsResponseSchema, (client) =>
    client.GET("/projects/{projectId}/skills", {
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.snapshot)
    )

export const writeProjectSkill = (
  projectId: string,
  scope: ProjectSkillScope,
  name: string,
  content: string
) =>
  openApiJsonSchema(ProjectSkillUpdateResponseSchema, (client) =>
    client.POST("/projects/{projectId}/skills", {
      body: { content, name, scope },
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.snapshot)
    )

export const deleteProjectSkill = (
  projectId: string,
  scope: ProjectSkillScope,
  name: string
) =>
  openApiJsonSchema(
    ProjectSkillsResponseSchema,
    (client) =>
      client.DELETE("/projects/{projectId}/skills/{scopeId}/{name}", {
        params: { path: { name, projectId, scopeId: projectSkillScopeToId(scope) } }
      })
  ).pipe(
    Effect.map((response) => response.snapshot)
  )
