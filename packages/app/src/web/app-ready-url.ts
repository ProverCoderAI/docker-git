import { useEffect, useRef } from "react"

import type { DashboardData } from "./api.js"
import type { BrowserShortcutArgs } from "./app-ready-shortcut-runtime.js"
import { browserMenuIndex, browserMenuItems, type BrowserMenuTag } from "./menu.js"
import { type BrowserScreen, isProjectMenu, menuScreen, outputScreen, screenForMenu } from "./screen.js"
import type { ActiveTerminalSession } from "./terminal.js"

type ReadyUrlNavigation = {
  readonly activeScreen: BrowserScreen
  readonly menu: BrowserMenuTag
  readonly projectNavigationArmed: boolean
  readonly selectedProjectId: string | null
}

type ReadyUrlSyncArgs = {
  readonly currentMenu: BrowserMenuTag
  readonly dashboard: DashboardData
  readonly state: Pick<
    BrowserShortcutArgs,
    | "activeScreen"
    | "selectedProjectId"
    | "setActiveScreen"
    | "setProjectNavigationArmed"
    | "setSelectedMenuIndex"
    | "setSelectedProjectId"
    | "terminalSession"
  >
}

type ReadyUrlPathArgs = {
  readonly activeScreen: BrowserScreen
  readonly currentMenu: BrowserMenuTag
  readonly selectedProjectId: string | null
  readonly selectedProjectSummary: DashboardData["projects"][number] | undefined
  readonly terminalSession: ActiveTerminalSession | null
}

const menuSlugs: Readonly<Record<BrowserMenuTag, string>> = {
  Auth: "auth",
  Browser: "browser",
  Create: "create",
  Databases: "databases",
  Delete: "delete",
  Down: "down",
  DownAll: "down-all",
  Info: "info",
  Logs: "logs",
  Ports: "ports",
  ProjectAuth: "project-auth",
  Quit: "quit",
  Select: "select",
  Status: "status"
}

const menuBySlug = new Map<string, BrowserMenuTag>(
  browserMenuItems.map(({ tag }) => [menuSlugs[tag], tag])
)

const reservedPathPrefixes: ReadonlyArray<string> = ["/api/", "/assets/", "/b/", "/d/", "/p/"]

const isSshLinkUrl = (url: URL): boolean =>
  url.pathname.startsWith("/ssh/") || ((url.searchParams.get("ssh") ?? "").trim().length > 0)

const isReservedPath = (pathname: string): boolean =>
  pathname === "/" || pathname === "/index.html" || reservedPathPrefixes.some((prefix) => pathname.startsWith(prefix))

const encodePathTail = (value: string): string =>
  value.split("/").map((segment) => encodeURIComponent(segment)).join("/")

const decodePathTail = (segments: ReadonlyArray<string>): string =>
  segments.map((segment) => decodeURIComponent(segment)).join("/").trim()

const projectToken = (project: DashboardData["projects"][number] | undefined, fallback: string | null): string | null =>
  project?.projectKey ?? fallback

const resolveProjectId = (
  projects: DashboardData["projects"],
  token: string
): string | null => {
  const normalizedToken = token.trim()
  if (normalizedToken.length === 0) {
    return null
  }
  const project = projects.find((candidate) =>
    candidate.id === normalizedToken ||
    candidate.projectKey === normalizedToken ||
    candidate.displayName === normalizedToken
  )
  return project?.id ?? null
}

const activeScreenFromMenu = (menu: BrowserMenuTag, outputRequested: boolean): BrowserScreen => {
  if (outputRequested && (menu === "Logs" || menu === "Status")) {
    return outputScreen()
  }
  if (menu === "ProjectAuth") {
    return { tag: "ProjectAuth" }
  }
  return screenForMenu(menu)
}

const parseMenuUrl = (rest: ReadonlyArray<string>): ReadyUrlNavigation | null => {
  const menu = menuBySlug.get(rest[0] ?? "")
  return menu === undefined
    ? null
    : {
      activeScreen: menuScreen(),
      menu,
      projectNavigationArmed: false,
      selectedProjectId: null
    }
}

const parseMenuActionUrl = (
  rawSlug: string,
  rest: ReadonlyArray<string>,
  projects: DashboardData["projects"]
): ReadyUrlNavigation | null => {
  const menu = menuBySlug.get(rawSlug)
  if (menu === undefined) {
    return null
  }

  const outputRequested = rest.at(-1) === "output"
  const projectSegments = outputRequested ? rest.slice(0, -1) : rest
  const selectedProjectId = isProjectMenu(menu) ? resolveProjectId(projects, decodePathTail(projectSegments)) : null
  return {
    activeScreen: activeScreenFromMenu(menu, outputRequested),
    menu,
    projectNavigationArmed: false,
    selectedProjectId
  }
}

export const parseReadyUrlNavigation = (
  href: string,
  projects: DashboardData["projects"]
): ReadyUrlNavigation | null => {
  const url = new URL(href, "http://localhost")
  if (isSshLinkUrl(url) || isReservedPath(url.pathname)) {
    return null
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return null
  }

  const rawSlug = segments[0]
  if (rawSlug === undefined) {
    return null
  }
  const rest = segments.slice(1)
  return rawSlug === "menu" ? parseMenuUrl(rest) : parseMenuActionUrl(rawSlug, rest, projects)
}

export const readyUrlPath = (
  {
    activeScreen,
    currentMenu,
    selectedProjectId,
    selectedProjectSummary,
    terminalSession
  }: ReadyUrlPathArgs
): string | null => {
  if (terminalSession?.browserProjectId !== undefined) {
    return `/ssh/${
      encodePathTail(
        projectToken(selectedProjectSummary, terminalSession.browserProjectId) ?? terminalSession.browserProjectId
      )
    }`
  }

  const slug = menuSlugs[currentMenu]
  if (activeScreen.tag === "Menu") {
    return `/menu/${slug}`
  }

  if (!isProjectMenu(currentMenu)) {
    return `/${slug}`
  }

  const token = projectToken(selectedProjectSummary, selectedProjectId)
  const projectSuffix = token === null ? "" : `/${encodePathTail(token)}`
  const outputSuffix = activeScreen.tag === "Output" ? "/output" : ""
  return `/${slug}${projectSuffix}${outputSuffix}`
}

const selectedProjectSummary = ({ dashboard, state }: ReadyUrlSyncArgs) =>
  dashboard.projects.find((project) => project.id === state.selectedProjectId)

const applyReadyUrlNavigation = (
  args: ReadyUrlSyncArgs,
  skipNextWriteRef: { current: boolean }
): void => {
  const next = parseReadyUrlNavigation(globalThis.location.href, args.dashboard.projects)
  if (next === null) {
    return
  }
  skipNextWriteRef.current = true
  args.state.setSelectedMenuIndex(browserMenuIndex(next.menu))
  args.state.setActiveScreen(next.activeScreen)
  args.state.setProjectNavigationArmed(next.projectNavigationArmed)
  args.state.setSelectedProjectId(next.selectedProjectId)
}

const writeReadyUrl = (
  args: ReadyUrlSyncArgs,
  skipInitialWriteRef: { current: boolean },
  skipNextWriteRef: { current: boolean }
) => {
  if (skipInitialWriteRef.current) {
    skipInitialWriteRef.current = false
    return
  }
  if (skipNextWriteRef.current) {
    skipNextWriteRef.current = false
    return
  }

  const currentUrl = new URL(globalThis.location.href)
  if (isSshLinkUrl(currentUrl) && args.state.terminalSession === null) {
    return
  }

  const path = readyUrlPath({
    activeScreen: args.state.activeScreen,
    currentMenu: args.currentMenu,
    selectedProjectId: args.state.selectedProjectId,
    selectedProjectSummary: selectedProjectSummary(args),
    terminalSession: args.state.terminalSession
  })
  if (path === null || `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}` === path) {
    return
  }
  globalThis.history.replaceState(globalThis.history.state, "", path)
}

export const useReadyUrlSync = (args: ReadyUrlSyncArgs) => {
  const argsRef = useRef(args)
  const skipInitialWriteRef = useRef(true)
  const skipNextWriteRef = useRef(false)

  argsRef.current = args

  useEffect(() => {
    // URL reads are limited to initial load and browser back/forward. Normal clicks
    // and arrow navigation write state to the URL instead of being overwritten by it.
    const applyCurrentLocation = () => {
      applyReadyUrlNavigation(argsRef.current, skipNextWriteRef)
    }

    applyCurrentLocation()
    const onPopState = applyCurrentLocation
    globalThis.addEventListener("popstate", onPopState)
    return () => {
      globalThis.removeEventListener("popstate", onPopState)
    }
  }, [])

  useEffect(() => {
    writeReadyUrl(args, skipInitialWriteRef, skipNextWriteRef)
  }, [
    args.state.activeScreen,
    args.currentMenu,
    args.state.selectedProjectId,
    selectedProjectSummary(args)?.projectKey,
    args.state.terminalSession,
    args.state.terminalSession?.browserProjectId
  ])
}
