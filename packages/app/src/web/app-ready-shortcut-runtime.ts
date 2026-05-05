import type { Dispatch, SetStateAction } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { BrowserActionContext } from "./actions.js"
import { runBrowserMenuAction } from "./actions.js"
import type { DashboardData, ProjectBrowserSession } from "./api.js"
import { browserSidecarUnavailableMessage, canRunProjectBrowserAction } from "./app-ready-browser-openable.js"
import { handleCreateKey } from "./app-ready-create.js"
import {
  handleMenuNavigationKey,
  handleProjectNavigationKey,
  isBlockedShortcut,
  refreshCurrentMenu
} from "./app-ready-shortcuts.js"
import type { BrowserMenuTag } from "./menu.js"
import { type BrowserScreen, isProjectMenu, menuScreen, projectPickerScreen, screenForMenu } from "./screen.js"
import type { ActiveTerminalSession } from "./terminal.js"

type Setter<A> = Dispatch<SetStateAction<A>>

export type BrowserShortcutArgs = {
  readonly activeScreen: BrowserScreen
  readonly activeTerminalSessionId: string | null
  readonly actionPrompt: ActionPromptState | null
  readonly context: BrowserActionContext
  readonly controllerCwd: string
  readonly createView: CreateFlowView
  readonly currentMenu: BrowserMenuTag
  readonly dashboard: DashboardData
  readonly projectsRoot: string
  readonly projectBrowser: ProjectBrowserSession | null
  readonly selectedProjectId: string | null
  readonly setCreateView: Setter<CreateFlowView>
  readonly setActiveScreen: Setter<BrowserScreen>
  readonly setProjectNavigationArmed: Setter<boolean>
  readonly setSelectedMenuIndex: Setter<number>
  readonly setSelectedProjectId: Setter<string | null>
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
}

type MenuOpenArgs = Pick<
  BrowserShortcutArgs,
  | "context"
  | "currentMenu"
  | "dashboard"
  | "selectedProjectId"
  | "setActiveScreen"
  | "setProjectNavigationArmed"
  | "setSelectedProjectId"
>

const shouldIgnoreShortcut = (
  activeTerminalSessionId: string | null,
  actionPrompt: ActionPromptState | null,
  event: KeyboardEvent
): boolean => activeTerminalSessionId !== null || isBlockedShortcut(event, actionPrompt !== null)

const openSelectedMenuScreen = ({
  context,
  currentMenu,
  dashboard,
  selectedProjectId,
  setActiveScreen,
  setProjectNavigationArmed,
  setSelectedProjectId
}: MenuOpenArgs): void => {
  if (currentMenu === "DownAll" || currentMenu === "Quit") {
    runBrowserMenuAction(currentMenu, context)
    return
  }
  setActiveScreen(screenForMenu(currentMenu))
  if (isProjectMenu(currentMenu)) {
    setProjectNavigationArmed(true)
    if (selectedProjectId === null) {
      setSelectedProjectId(dashboard.projects[0]?.id ?? null)
    }
  }
}

const handleMenuScreenKey = (
  event: KeyboardEvent,
  {
    context,
    currentMenu,
    dashboard,
    selectedProjectId,
    setActiveScreen,
    setProjectNavigationArmed,
    setSelectedProjectId
  }: MenuOpenArgs
): boolean => {
  if (event.key === "ArrowRight" || event.key === "Enter") {
    event.preventDefault()
    openSelectedMenuScreen({
      context,
      currentMenu,
      dashboard,
      selectedProjectId,
      setActiveScreen,
      setProjectNavigationArmed,
      setSelectedProjectId
    })
    return true
  }
  return false
}

const runProjectPickerAction = (
  currentMenu: BrowserMenuTag,
  context: BrowserActionContext,
  projectBrowser: ProjectBrowserSession | null,
  setActiveScreen: Setter<BrowserScreen>
): void => {
  if (!canRunProjectBrowserAction(currentMenu, projectBrowser, context.selectedProjectId)) {
    context.setMessage(browserSidecarUnavailableMessage)
    return
  }
  if (currentMenu === "ProjectAuth") {
    setActiveScreen({ tag: "ProjectAuth" })
    runBrowserMenuAction(currentMenu, context)
    return
  }
  if (currentMenu === "Logs" || currentMenu === "Status") {
    setActiveScreen({ tag: "Output" })
    runBrowserMenuAction(currentMenu, context)
    return
  }
  runBrowserMenuAction(currentMenu, context)
}

const handleRefreshShortcut = (
  event: KeyboardEvent,
  { context, currentMenu }: Pick<BrowserShortcutArgs, "context" | "currentMenu">
): boolean => {
  if (event.key !== "r" && event.key !== "R") {
    return false
  }
  event.preventDefault()
  refreshCurrentMenu(currentMenu, context)
  return true
}

const handleProjectPickerShortcut = (
  event: KeyboardEvent,
  args: Pick<
    BrowserShortcutArgs,
    | "context"
    | "currentMenu"
    | "dashboard"
    | "projectBrowser"
    | "selectedProjectId"
    | "setActiveScreen"
    | "setProjectNavigationArmed"
    | "setSelectedProjectId"
  >
): boolean => {
  if (event.key === "Escape" || event.key === "ArrowLeft") {
    event.preventDefault()
    args.setProjectNavigationArmed(false)
    args.setActiveScreen(menuScreen())
    args.context.setMessage("Returned to main menu.")
    return true
  }
  if (
    handleProjectNavigationKey(event, {
      currentMenu: args.currentMenu,
      dashboard: args.dashboard,
      projectNavigationArmed: true,
      selectedProjectId: args.selectedProjectId,
      setSelectedProjectId: args.setSelectedProjectId
    })
  ) {
    return true
  }
  if (event.key === "Enter") {
    event.preventDefault()
    runProjectPickerAction(args.currentMenu, args.context, args.projectBrowser, args.setActiveScreen)
    return true
  }
  return handleRefreshShortcut(event, args)
}

const handleBackToMenuShortcut = (
  event: KeyboardEvent,
  context: BrowserActionContext,
  setActiveScreen: Setter<BrowserScreen>,
  returnToProjectPicker: boolean
): boolean => {
  if (event.key !== "Escape" && event.key !== "ArrowLeft") {
    return false
  }
  event.preventDefault()
  setActiveScreen(returnToProjectPicker ? projectPickerScreen() : menuScreen())
  context.setMessage(returnToProjectPicker ? "Returned to project selection." : "Returned to main menu.")
  return true
}

const handleOutputShortcut = (
  event: KeyboardEvent,
  args: Pick<BrowserShortcutArgs, "context" | "currentMenu" | "setActiveScreen">
): void => {
  if (handleBackToMenuShortcut(event, args.context, args.setActiveScreen, isProjectMenu(args.currentMenu))) {
    return
  }
  handleRefreshShortcut(event, args)
}

const handleContentShortcut = (
  event: KeyboardEvent,
  args: Pick<BrowserShortcutArgs, "context" | "currentMenu" | "setActiveScreen">
): void => {
  handleBackToMenuShortcut(event, args.context, args.setActiveScreen, false)
  handleRefreshShortcut(event, args)
}

const handleMenuShortcut = (
  event: KeyboardEvent,
  args: Pick<
    BrowserShortcutArgs,
    | "context"
    | "currentMenu"
    | "dashboard"
    | "selectedProjectId"
    | "setActiveScreen"
    | "setProjectNavigationArmed"
    | "setSelectedMenuIndex"
    | "setSelectedProjectId"
  >
): void => {
  if (handleMenuNavigationKey(event, args.currentMenu, false, args.setSelectedMenuIndex)) {
    return
  }
  handleMenuScreenKey(event, args)
}

const handleCreateShortcut = (
  event: KeyboardEvent,
  args: Pick<
    BrowserShortcutArgs,
    "context" | "controllerCwd" | "createView" | "projectsRoot" | "setActiveScreen" | "setCreateView"
  >
): void => {
  const handled = handleCreateKey(event, {
    context: args.context,
    controllerCwd: args.controllerCwd,
    projectsRoot: args.projectsRoot,
    createView: args.createView,
    setCreateView: args.setCreateView
  })
  if (handled && event.key === "Escape") {
    args.setActiveScreen(menuScreen())
  }
}

const dispatchActiveScreenShortcut = (event: KeyboardEvent, args: BrowserShortcutArgs): void => {
  if (args.activeScreen.tag === "Menu") {
    handleMenuShortcut(event, args)
    return
  }

  if (args.activeScreen.tag === "Create") {
    handleCreateShortcut(event, args)
    return
  }

  if (args.activeScreen.tag === "ProjectPicker") {
    handleProjectPickerShortcut(event, args)
    return
  }

  if (args.activeScreen.tag === "Output") {
    handleOutputShortcut(event, args)
    return
  }

  if (args.activeScreen.tag === "ProjectAuth") {
    handleBackToMenuShortcut(event, args.context, args.setActiveScreen, true)
    return
  }

  handleContentShortcut(event, args)
}

export const dispatchBrowserShortcut = (event: KeyboardEvent, args: BrowserShortcutArgs): void => {
  if (shouldIgnoreShortcut(args.activeTerminalSessionId, args.actionPrompt, event)) {
    return
  }
  dispatchActiveScreenShortcut(event, args)
}
