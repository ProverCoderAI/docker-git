import { openSkillerApp } from "./actions-skiller.js"
import type { createActionContext } from "./app-ready-actions.js"

export const bindSkillerActions = (
  actionContext: ReturnType<typeof createActionContext>
) => ({
  onOpenSkiller: (projectKey?: string, sessionId?: string) => {
    openSkillerApp(actionContext, projectKey ?? actionContext.selectedProjectKey, sessionId)
  }
})
