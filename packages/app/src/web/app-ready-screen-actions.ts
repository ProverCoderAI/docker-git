import { runBrowserMenuAction } from "./actions.js"
import type { DashboardData } from "./api.js"
import type { createActionContext } from "./app-ready-actions.js"
import { resolveCurrentMenu } from "./app-ready-actions.js"
import { browserSidecarUnavailableMessage, canRunProjectBrowserAction } from "./app-ready-browser-openable.js"
import { cancelCreate } from "./app-ready-create.js"
import type { ReadyState } from "./app-ready-hooks.js"
import { isProjectMenu, menuScreen, outputScreen, projectPickerScreen, screenForMenu } from "./screen.js"

const runCurrentMenuAction = (
  actionContext: ReturnType<typeof createActionContext>,
  state: ReadyState
) => {
  const menu = resolveCurrentMenu(state.selectedMenuIndex)
  if (!canRunProjectBrowserAction(menu, state.projectBrowser, state.selectedProjectId)) {
    state.setMessage(browserSidecarUnavailableMessage)
    return
  }
  if (menu === "ProjectAuth") {
    state.setActiveScreen({ tag: "ProjectAuth" })
    runBrowserMenuAction(menu, actionContext)
    return
  }
  if (menu === "Logs" || menu === "Status") {
    state.setActiveScreen(outputScreen())
    runBrowserMenuAction(menu, actionContext)
    return
  }
  runBrowserMenuAction(menu, actionContext)
}

export const bindScreenActions = (
  actionContext: ReturnType<typeof createActionContext>,
  dashboard: DashboardData,
  state: ReadyState
) => ({
  onBackScreen: () => {
    if (state.activeScreen.tag === "Create") {
      cancelCreate(actionContext, state.setCreationView)
      return
    }
    if (state.activeScreen.tag === "ProjectAuth" || state.activeScreen.tag === "Output") {
      const backScreen = isProjectMenu(resolveCurrentMenu(state.selectedMenuIndex))
        ? projectPickerScreen
        : menuScreen
      state.setActiveScreen(backScreen())
      return
    }
    state.setProjectNavigationArmed(false)
    state.setActiveScreen(menuScreen())
  },
  onOpenMenuScreen: (index: number) => {
    const menu = resolveCurrentMenu(index)
    state.setSelectedMenuIndex(index)
    if (menu === "DownAll" || menu === "Quit") {
      runBrowserMenuAction(menu, actionContext)
      return
    }
    state.setActiveScreen(screenForMenu(menu))
    if (isProjectMenu(menu)) {
      state.setProjectNavigationArmed(true)
      state.setSelectedProjectId((projectId) => projectId ?? dashboard.projects[0]?.id ?? null)
    }
  },
  onRunCurrentMenuAction: () => {
    runCurrentMenuAction(actionContext, state)
  }
})
