import { Effect } from "effect"

import { requestJson } from "./api-http.js"
import { ProjectSkillsResponseSchema, ProjectSkillUpdateResponseSchema } from "./api-schema.js"
import type { ProjectSkillScope } from "./api-schema.js"

const skillScopeIdByScope: Readonly<Record<ProjectSkillScope, string>> = {
  "skills": "skills",
  "agents/skills": "agents-skills",
  "agents/.skills": "agents-dot-skills",
  "claude/skills": "claude-skills",
  "codex/skills": "codex-skills",
  "gemini/skills": "gemini-skills"
}

export const projectSkillScopeToId = (scope: ProjectSkillScope): string => skillScopeIdByScope[scope]

export const loadProjectSkills = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/skills`,
    ProjectSkillsResponseSchema
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const writeProjectSkill = (
  projectId: string,
  scope: ProjectSkillScope,
  name: string,
  content: string
) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/skills`,
    ProjectSkillUpdateResponseSchema,
    { scope, name, content }
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const deleteProjectSkill = (
  projectId: string,
  scope: ProjectSkillScope,
  name: string
) =>
  requestJson(
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(projectSkillScopeToId(scope))}/${
      encodeURIComponent(name)
    }`,
    ProjectSkillsResponseSchema
  ).pipe(
    Effect.map((response) => response.snapshot)
  )
