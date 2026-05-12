import { deleteSelectedProjectSkill, loadSelectedProjectSkills, saveSelectedProjectSkill } from "./actions.js"
import type { ProjectSkillScope } from "./api.js"
import type { createActionContext } from "./app-ready-actions.js"

export const bindSkillActions = (
  actionContext: ReturnType<typeof createActionContext>
) => ({
  onDeleteProjectSkill: (scope: ProjectSkillScope, name: string) => {
    deleteSelectedProjectSkill(actionContext, scope, name)
  },
  onRefreshProjectSkills: () => {
    loadSelectedProjectSkills(actionContext)
  },
  onSaveProjectSkill: (scope: ProjectSkillScope, name: string, content: string) => {
    saveSelectedProjectSkill(actionContext, scope, name, content)
  }
})
