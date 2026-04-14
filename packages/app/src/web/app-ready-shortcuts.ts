import { Match } from "effect"
import type { Dispatch, SetStateAction } from "react"

import type { BrowserActionContext } from "./actions.js"
import {
  loadSelectedProjectInfo,
  loadSelectedProjectPorts,
  refreshAuthPanel,
  refreshProjectAuthPanel,
  runBrowserMenuAction
} from "./actions.js"
import type { AuthSnapshot, DashboardData, ProjectAuthSnapshot } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import { browserMenuItems } from "./menu.js"

type Setter<A> = Dispatch<SetStateAction<A>>

export type ShortcutKeyboardEvent = {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  defaultPrevented: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly target: EventTarget | null
  preventDefault: () => void
}

type ProjectNavigationArgs = {
  readonly currentMenu: BrowserMenuTag
  readonly dashboard: DashboardData
  readonly projectNavigationArmed: boolean
  readonly selectedProjectId: string | null
  readonly setSelectedProjectId: Setter<string | null>
}

type ShortcutTarget = EventTarget & {
  readonly isContentEditable?: boolean
  readonly tagName: string
}

const isShortcutTarget = (target: EventTarget | null): target is ShortcutTarget =>
  typeof target === "object" &&
  target !== null &&
  "tagName" in target &&
  typeof target.tagName === "string"

const isEditableShortcutTarget = (target: EventTarget | null): boolean => {
  if (!isShortcutTarget(target)) {
    return false
  }
  return target.isContentEditable === true ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA"
}

const isNativeActionTarget = (target: EventTarget | null): boolean =>
  isShortcutTarget(target) && (target.tagName === "A" || target.tagName === "BUTTON")

const isVerticalArrowKey = (event: ShortcutKeyboardEvent): boolean =>
  event.key === "ArrowUp" || event.key === "ArrowDown"

const projectPrimaryNavigationMenus: ReadonlySet<BrowserMenuTag> = new Set([
  "Delete",
  "Down",
  "Info",
  "Logs",
  "Ports",
  "ProjectAuth",
  "Select",
  "Status"
])

const resolveVerticalArrowDelta = (key: string): number | null => {
  if (key === "ArrowUp") {
    return -1
  }
  if (key === "ArrowDown") {
    return 1
  }
  return null
}

const resolveRefreshAction = (
  currentMenu: BrowserMenuTag
): (context: BrowserActionContext) => void =>
  Match.value(currentMenu).pipe(
    Match.when("Auth", () => refreshAuthPanel),
    Match.when("Ports", () => loadSelectedProjectPorts),
    Match.when("ProjectAuth", () => refreshProjectAuthPanel),
    Match.orElse(() => loadSelectedProjectInfo)
  )

const cycleProjectId = (
  dashboard: DashboardData,
  selectedProjectId: string | null,
  delta: number
): string | null => {
  if (dashboard.projects.length === 0) {
    return null
  }
  const currentIndex = dashboard.projects.findIndex((project) => project.id === selectedProjectId)
  if (currentIndex === -1) {
    return dashboard.projects[0]?.id ?? null
  }
  const nextIndex = (currentIndex + delta + dashboard.projects.length) % dashboard.projects.length
  return dashboard.projects[nextIndex]?.id ?? null
}

export const normalizeSelectedProjectId = (
  dashboard: DashboardData,
  selectedProjectId: string | null
): string | null => {
  if (selectedProjectId === null) {
    return null
  }
  const exists = dashboard.projects.some((project) => project.id === selectedProjectId)
  return exists ? selectedProjectId : dashboard.projects[0]?.id ?? null
}

export const refreshCurrentMenu = (
  currentMenu: BrowserMenuTag,
  context: BrowserActionContext
) => {
  resolveRefreshAction(currentMenu)(context)
}

export const shouldLoadProjectDetails = (currentMenu: BrowserMenuTag): boolean =>
  Match.value(currentMenu).pipe(
    Match.when("Delete", () => true),
    Match.when("Down", () => true),
    Match.when("Info", () => true),
    Match.when("Logs", () => true),
    Match.when("Ports", () => true),
    Match.when("ProjectAuth", () => true),
    Match.when("Select", () => true),
    Match.when("Status", () => true),
    Match.orElse(() => false)
  )

export const usesProjectPrimaryNavigation = (currentMenu: BrowserMenuTag): boolean =>
  projectPrimaryNavigationMenus.has(currentMenu)

const menuNavigationDelta = (
  currentMenu: BrowserMenuTag,
  projectNavigationArmed: boolean,
  key: string
): number | null => {
  if (usesProjectPrimaryNavigation(currentMenu) && projectNavigationArmed) {
    return null
  }
  return resolveVerticalArrowDelta(key)
}

export const handleMenuNavigationKey = (
  event: ShortcutKeyboardEvent,
  currentMenu: BrowserMenuTag,
  projectNavigationArmed: boolean,
  setSelectedMenuIndex: Setter<number>
): boolean => {
  const delta = menuNavigationDelta(currentMenu, projectNavigationArmed, event.key)
  if (delta === null) {
    return false
  }
  event.preventDefault()
  if (delta < 0) {
    setSelectedMenuIndex((index) => (index > 0 ? index - 1 : browserMenuItems.length - 1))
    return true
  }
  setSelectedMenuIndex((index) => (index + 1) % browserMenuItems.length)
  return true
}

const projectNavigationDelta = (
  currentMenu: BrowserMenuTag,
  projectNavigationArmed: boolean,
  key: string
): number | null => {
  if (!usesProjectPrimaryNavigation(currentMenu) || !projectNavigationArmed) {
    return null
  }
  return resolveVerticalArrowDelta(key)
}

export const handleProjectNavigationKey = (
  event: ShortcutKeyboardEvent,
  {
    currentMenu,
    dashboard,
    projectNavigationArmed,
    selectedProjectId,
    setSelectedProjectId
  }: ProjectNavigationArgs
): boolean => {
  const delta = projectNavigationDelta(currentMenu, projectNavigationArmed, event.key)
  if (delta === null) {
    return false
  }
  event.preventDefault()
  setSelectedProjectId(cycleProjectId(dashboard, selectedProjectId, delta))
  return true
}

export const handleActionKey = (
  event: ShortcutKeyboardEvent,
  currentMenu: BrowserMenuTag,
  projectNavigationArmed: boolean,
  context: BrowserActionContext
): boolean => {
  if (event.key === "Enter") {
    if (
      isNativeActionTarget(event.target) &&
      !(usesProjectPrimaryNavigation(currentMenu) && projectNavigationArmed)
    ) {
      return false
    }
    event.preventDefault()
    runBrowserMenuAction(currentMenu, context)
    return true
  }
  if (event.key === "r" || event.key === "R") {
    event.preventDefault()
    refreshCurrentMenu(currentMenu, context)
    return true
  }
  return false
}

export const shouldRefreshAuthPanel = (
  currentMenu: BrowserMenuTag,
  authSnapshot: AuthSnapshot | null
): boolean => currentMenu === "Auth" && authSnapshot === null

export const shouldRefreshProjectAuthPanel = (
  currentMenu: BrowserMenuTag,
  projectAuthSnapshot: ProjectAuthSnapshot | null
): boolean => currentMenu === "ProjectAuth" && projectAuthSnapshot === null

export const shouldRefreshProjectDetails = (
  currentMenu: BrowserMenuTag,
  _projectNavigationArmed: boolean,
  selectedProjectId: string | null
): boolean => shouldLoadProjectDetails(currentMenu) && selectedProjectId !== null

export const shortcutHintText = (
  currentMenu: BrowserMenuTag,
  projectNavigationArmed: boolean
): string => {
  if (usesProjectPrimaryNavigation(currentMenu)) {
    return projectNavigationArmed
      ? "↑/↓ project, Enter run, Esc/← back"
      : "↑/↓ menu, Enter/→ choose project"
  }
  return "↑/↓ menu"
}

export const isBlockedShortcut = (
  event: ShortcutKeyboardEvent,
  hasInlinePrompt: boolean
): boolean =>
  event.defaultPrevented ||
  event.altKey ||
  event.ctrlKey ||
  event.metaKey ||
  (isEditableShortcutTarget(event.target) && (hasInlinePrompt || !isVerticalArrowKey(event)))
