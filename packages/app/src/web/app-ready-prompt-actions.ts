import { deleteSelectedProjectPrompt, loadSelectedProjectPrompts, saveSelectedProjectPrompt } from "./actions.js"
import type { ProjectPromptKind } from "./api.js"
import type { createActionContext } from "./app-ready-actions.js"

export const bindPromptActions = (
  actionContext: ReturnType<typeof createActionContext>
) => ({
  onDeleteProjectPrompt: (kind: ProjectPromptKind) => {
    deleteSelectedProjectPrompt(actionContext, kind)
  },
  onRefreshProjectPrompts: () => {
    loadSelectedProjectPrompts(actionContext)
  },
  onSaveProjectPrompt: (kind: ProjectPromptKind, content: string) => {
    saveSelectedProjectPrompt(actionContext, kind, content)
  }
})
