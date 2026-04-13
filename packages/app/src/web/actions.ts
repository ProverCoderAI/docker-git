import { refreshAuthPanel, refreshProjectAuthPanel } from "./actions-auth.js"
import { runProjectMenuAction } from "./actions-projects.js"
import type { BrowserActionContext } from "./actions-shared.js"
import type { BrowserMenuTag } from "./menu.js"

export type { BrowserActionContext } from "./actions-shared.js"

export {
  cancelBrowserActionPrompt,
  refreshAuthPanel,
  refreshProjectAuthPanel,
  runBrowserAuthAction,
  runBrowserProjectAuthAction,
  submitBrowserActionPrompt
} from "./actions-auth.js"
export { loadSelectedProjectInfo } from "./actions-projects.js"

export const runBrowserMenuAction = (
  currentMenu: BrowserMenuTag,
  context: BrowserActionContext
) => {
  if (currentMenu === "Auth") {
    refreshAuthPanel(context)
    return
  }
  if (currentMenu === "ProjectAuth") {
    refreshProjectAuthPanel(context)
    return
  }
  runProjectMenuAction(currentMenu, context)
}
