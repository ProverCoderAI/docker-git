import type { Dispatch, SetStateAction } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { BrowserActionContext } from "./actions.js"
import type { DashboardData } from "./api.js"
import { handleCreateKey } from "./app-ready-create.js"
import {
  handleActionKey,
  handleMenuNavigationKey,
  handleProjectNavigationKey,
  isBlockedShortcut,
  usesProjectPrimaryNavigation
} from "./app-ready-shortcuts.js"
import type { BrowserMenuTag } from "./menu.js"
import type { ActiveTerminalSession } from "./terminal.js"

type Setter<A> = Dispatch<SetStateAction<A>>

export type BrowserShortcutArgs = {
  readonly actionPrompt: ActionPromptState | null
  readonly context: BrowserActionContext
  readonly controllerCwd: string
  readonly createView: CreateFlowView
  readonly currentMenu: BrowserMenuTag
  readonly dashboard: DashboardData
  readonly projectNavigationArmed: boolean
  readonly projectsRoot: string
  readonly selectedProjectId: string | null
  readonly setCreateView: Setter<CreateFlowView>
  readonly setProjectNavigationArmed: Setter<boolean>
  readonly setSelectedMenuIndex: Setter<number>
  readonly setSelectedProjectId: Setter<string | null>
  readonly terminalSession: ActiveTerminalSession | null
}

type ProjectNavigationModeArgs = Pick<
  BrowserShortcutArgs,
  | "context"
  | "currentMenu"
  | "dashboard"
  | "projectNavigationArmed"
  | "selectedProjectId"
  | "setProjectNavigationArmed"
  | "setSelectedProjectId"
>

const shouldIgnoreShortcut = (
  actionPrompt: ActionPromptState | null,
  event: KeyboardEvent,
  terminalSession: ActiveTerminalSession | null
): boolean => terminalSession !== null || isBlockedShortcut(event, actionPrompt !== null)

const armProjectNavigation = ({
  dashboard,
  selectedProjectId,
  setProjectNavigationArmed,
  setSelectedProjectId
}: Pick<
  ProjectNavigationModeArgs,
  "dashboard" | "selectedProjectId" | "setProjectNavigationArmed" | "setSelectedProjectId"
>) => {
  setProjectNavigationArmed(true)
  if (selectedProjectId === null) {
    setSelectedProjectId(dashboard.projects[0]?.id ?? null)
  }
}

const handleProjectNavigationModeKey = (
  event: KeyboardEvent,
  {
    context,
    currentMenu,
    dashboard,
    projectNavigationArmed,
    selectedProjectId,
    setProjectNavigationArmed,
    setSelectedProjectId
  }: ProjectNavigationModeArgs
): boolean => {
  if (!usesProjectPrimaryNavigation(currentMenu)) {
    return false
  }
  if (!projectNavigationArmed && (event.key === "ArrowRight" || event.key === "Enter")) {
    event.preventDefault()
    armProjectNavigation({
      dashboard,
      selectedProjectId,
      setProjectNavigationArmed,
      setSelectedProjectId
    })
    context.setMessage("Project selection active. Use ↑/↓ to choose a project, Enter to run, Esc or ← to return.")
    return true
  }
  if (projectNavigationArmed && (event.key === "Escape" || event.key === "ArrowLeft")) {
    event.preventDefault()
    setProjectNavigationArmed(false)
    context.setMessage("Returned to menu navigation.")
    return true
  }
  return false
}

const handleReadyShortcut = (
  event: KeyboardEvent,
  args: Pick<
    BrowserShortcutArgs,
    | "context"
    | "currentMenu"
    | "dashboard"
    | "projectNavigationArmed"
    | "selectedProjectId"
    | "setProjectNavigationArmed"
    | "setSelectedMenuIndex"
    | "setSelectedProjectId"
  >
): boolean => {
  if (handleProjectNavigationModeKey(event, args)) {
    return true
  }
  if (handleMenuNavigationKey(event, args.currentMenu, args.projectNavigationArmed, args.setSelectedMenuIndex)) {
    return true
  }
  if (
    handleProjectNavigationKey(event, {
      currentMenu: args.currentMenu,
      dashboard: args.dashboard,
      projectNavigationArmed: args.projectNavigationArmed,
      selectedProjectId: args.selectedProjectId,
      setSelectedProjectId: args.setSelectedProjectId
    })
  ) {
    return true
  }
  return handleActionKey(event, args.currentMenu, args.context)
}

export const dispatchBrowserShortcut = (
  event: KeyboardEvent,
  {
    actionPrompt,
    context,
    controllerCwd,
    createView,
    currentMenu,
    dashboard,
    projectNavigationArmed,
    projectsRoot,
    selectedProjectId,
    setCreateView,
    setProjectNavigationArmed,
    setSelectedMenuIndex,
    setSelectedProjectId,
    terminalSession
  }: BrowserShortcutArgs
) => {
  if (shouldIgnoreShortcut(actionPrompt, event, terminalSession)) {
    return
  }
  if (
    currentMenu === "Create" &&
    handleCreateKey(event, { context, controllerCwd, projectsRoot, createView, setCreateView })
  ) {
    return
  }
  handleReadyShortcut(event, {
    context,
    currentMenu,
    dashboard,
    projectNavigationArmed,
    selectedProjectId,
    setProjectNavigationArmed,
    setSelectedMenuIndex,
    setSelectedProjectId
  })
}
