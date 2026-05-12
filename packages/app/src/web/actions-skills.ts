import { type BrowserActionContext, requireSelectedProjectId, withBusy } from "./actions-shared.js"
import { deleteProjectSkill, loadProjectSkills, writeProjectSkill } from "./api.js"
import type { ProjectSkillScope } from "./api.js"

const requireProjectIdForSkills = (context: BrowserActionContext): string | null => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setProjectSkills(null)
  }
  return projectId
}

export const loadSelectedProjectSkills = (
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  const projectId = requireProjectIdForSkills(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: loadProjectSkills(projectId),
    label: "Loading project skills",
    onSuccess: (snapshot) => {
      context.setProjectSkills(snapshot)
      if (options?.silent !== true) {
        context.setMessage(`Loaded ${snapshot.skills.length} skill(s) for ${snapshot.projectKey}.`)
      }
    }
  })
}

export const saveSelectedProjectSkill = (
  context: BrowserActionContext,
  scope: ProjectSkillScope,
  name: string,
  content: string
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  const trimmedName = name.trim()
  if (trimmedName.length === 0) {
    context.setMessage("Skill name is required.")
    return
  }
  withBusy({
    context,
    effect: writeProjectSkill(projectId, scope, trimmedName, content),
    label: `Saving skill ${trimmedName}`,
    onSuccess: (snapshot) => {
      context.setProjectSkills(snapshot)
      context.setMessage(`Saved skill ${scope}/${trimmedName}.`)
    }
  })
}

export const deleteSelectedProjectSkill = (
  context: BrowserActionContext,
  scope: ProjectSkillScope,
  name: string
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: deleteProjectSkill(projectId, scope, name),
    label: `Deleting skill ${name}`,
    onSuccess: (snapshot) => {
      context.setProjectSkills(snapshot)
      context.setMessage(`Deleted skill ${scope}/${name}.`)
    }
  })
}
