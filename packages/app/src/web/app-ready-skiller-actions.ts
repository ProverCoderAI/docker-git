import { openSkillerApp } from "./actions-skiller.js"
import type { createActionContext } from "./app-ready-actions.js"

export const bindSkillerActions = (
  actionContext: ReturnType<typeof createActionContext>
) => ({
  onOpenSkiller: () => {
    openSkillerApp(actionContext)
  }
})
