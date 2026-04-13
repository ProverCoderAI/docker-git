import type { JSX } from "react"

import { buildSelectLabels, type SelectPurpose } from "../docker-git/menu-select-presenter.js"
import type { DashboardData } from "./api.js"
import { shortcutHintText } from "./app-ready-shortcuts.js"
import { Box, Text } from "./elements.js"
import { browserMenuItems } from "./menu.js"
import type { BrowserMenuTag } from "./menu.js"
import { selectPurposeForMenu } from "./panel-project-details.js"

type MenuSidebarProps = {
  readonly compact: boolean
  readonly currentMenu: BrowserMenuTag
  readonly onSelectMenu: (index: number) => void
  readonly projectNavigationArmed: boolean
  readonly selectedMenuIndex: number
  readonly selectedProjectLabel: string
}

type ProjectListPanelProps = {
  readonly compact: boolean
  readonly currentMenu: BrowserMenuTag
  readonly dashboard: DashboardData
  readonly onSelectProject: (projectId: string) => void
  readonly projectNavigationArmed: boolean
  readonly selectedProjectId: string | null
}

export const showsProjectPanel = (currentMenu: BrowserMenuTag): boolean => currentMenu === "Select"

export const projectSelectionLabel = (
  project: DashboardData["projects"][number] | undefined
): string => project === undefined ? "not selected" : `${project.displayName} · ${project.statusLabel}`

const renderListPurpose = (currentMenu: BrowserMenuTag): SelectPurpose => selectPurposeForMenu(currentMenu) ?? "Connect"

const compactMenuLabels: Readonly<Record<BrowserMenuTag, string>> = {
  Auth: "Auth profiles",
  Create: "Create",
  Delete: "Delete",
  Down: "Down",
  DownAll: "Down all",
  Info: "Info",
  Logs: "Logs",
  ProjectAuth: "Project auth",
  Quit: "Quit",
  Select: "Select",
  Status: "Status"
}

const menuPanelMaxHeight = (compact: boolean): string => compact ? "154px" : "100%"
const menuListDirection = (compact: boolean): "column" | "row" => compact ? "row" : "column"
const menuListTopMargin = (compact: boolean): number | string => compact ? "6px" : 1
const projectPanelMaxHeight = (compact: boolean): string => compact ? "30%" : "100%"

const runtimeByProject = (dashboard: DashboardData): Readonly<
  Record<string, {
    readonly running: boolean
    readonly sshSessions: number
    readonly startedAtIso: string | null
    readonly startedAtEpochMs: number | null
  }>
> =>
  Object.fromEntries(
    dashboard.projects.map((project) => [
      project.id,
      {
        running: project.status === "running",
        sshSessions: project.sshSessions,
        startedAtIso: project.startedAtIso,
        startedAtEpochMs: project.startedAtEpochMs
      }
    ])
  )

const stripSelectionPrefix = (label: string): string => label.slice(2)

const resolveProjectListSelectionIndex = (
  currentMenu: BrowserMenuTag,
  dashboard: DashboardData,
  projectNavigationArmed: boolean,
  selectedProjectId: string | null
): number =>
  !showsProjectPanel(currentMenu) || projectNavigationArmed
    ? dashboard.projects.findIndex((project) => project.id === selectedProjectId)
    : -1

const buildProjectListLabels = (
  currentMenu: BrowserMenuTag,
  dashboard: DashboardData,
  selectedIndex: number
): ReadonlyArray<string> =>
  (
    buildSelectLabels(
      dashboard.projects.map((project) => ({
        clonedOnHostname: project.clonedOnHostname,
        displayName: project.displayName,
        projectDir: project.id,
        repoRef: project.repoRef
      })),
      selectedIndex === -1 ? 0 : selectedIndex,
      renderListPurpose(currentMenu),
      runtimeByProject(dashboard)
    )
  ).map((label) => selectedIndex === -1 ? stripSelectionPrefix(label) : label)

const MenuHeader = ({ compact }: Pick<MenuSidebarProps, "compact">): JSX.Element => (
  <Box flexWrap="wrap" gap={1} justifyContent="space-between">
    <Text bold={true} fg="#8be9fd">{compact ? "docker-git menu" : "bun run docker-git"}</Text>
    {compact ? null : <Text fg="#7ba6cc">browser inheritance shell</Text>}
  </Box>
)

const SelectedProjectLine = (
  { selectedProjectLabel }: Pick<MenuSidebarProps, "selectedProjectLabel">
): JSX.Element => (
  <Text fg="#5bd1ff" marginTop="4px" wrap="truncate" width="100%">
    selected project: {selectedProjectLabel}
  </Text>
)

const MenuItemsList = (
  { compact, onSelectMenu, selectedMenuIndex }: Pick<
    MenuSidebarProps,
    "compact" | "onSelectMenu" | "selectedMenuIndex"
  >
): JSX.Element => (
  <Box
    flexDirection={menuListDirection(compact)}
    flexWrap={compact ? "wrap" : "nowrap"}
    gap="4px"
    marginTop={menuListTopMargin(compact)}
  >
    {browserMenuItems.map((item, index) => (
      <Box
        key={item.tag}
        onClick={() => {
          onSelectMenu(index)
        }}
        width={compact ? "auto" : "100%"}
      >
        <Text bold={index === selectedMenuIndex} fg={index === selectedMenuIndex ? "#56f39a" : "#d6e5f7"}>
          {index === selectedMenuIndex ? "> " : "  "}
          {index + 1}. {compactMenuLabels[item.tag]}
        </Text>
      </Box>
    ))}
  </Box>
)

const MenuHints = (
  { compact, currentMenu, projectNavigationArmed }: Pick<
    MenuSidebarProps,
    "compact" | "currentMenu" | "projectNavigationArmed"
  >
): JSX.Element => (
  <Box
    flexDirection={compact ? "row" : "column"}
    flexWrap="wrap"
    gap={compact ? 1 : 0}
    marginTop={compact ? "6px" : 1}
  >
    {compact ? null : <Text fg="#8fa6c4">keys:</Text>}
    <Text fg="#8fa6c4">{shortcutHintText(currentMenu, projectNavigationArmed)}</Text>
    {compact ? null : <Text fg="#8fa6c4">Enter run, R refresh, Esc cancel create</Text>}
  </Box>
)

export const MenuSidebar = (
  {
    compact,
    currentMenu,
    onSelectMenu,
    projectNavigationArmed,
    selectedMenuIndex,
    selectedProjectLabel
  }: MenuSidebarProps
): JSX.Element => (
  <Box
    border={true}
    borderColor="#24537d"
    borderStyle="single"
    flexShrink={0}
    flexDirection="column"
    maxHeight={menuPanelMaxHeight(compact)}
    minHeight={0}
    overflowY="auto"
    padding={1}
    width={compact ? "100%" : "240px"}
  >
    <MenuHeader compact={compact} />
    <SelectedProjectLine selectedProjectLabel={selectedProjectLabel} />
    <MenuItemsList compact={compact} onSelectMenu={onSelectMenu} selectedMenuIndex={selectedMenuIndex} />
    <MenuHints compact={compact} currentMenu={currentMenu} projectNavigationArmed={projectNavigationArmed} />
  </Box>
)

export const ProjectListPanel = (
  { compact, currentMenu, dashboard, onSelectProject, projectNavigationArmed, selectedProjectId }: ProjectListPanelProps
): JSX.Element => {
  const selectedIndex = resolveProjectListSelectionIndex(
    currentMenu,
    dashboard,
    projectNavigationArmed,
    selectedProjectId
  )
  const labels = buildProjectListLabels(currentMenu, dashboard, selectedIndex)

  return (
    <Box
      border={true}
      borderColor="#24537d"
      borderStyle="single"
      flexDirection="column"
      flexShrink={compact ? 1 : 0}
      maxHeight={projectPanelMaxHeight(compact)}
      minHeight={0}
      overflowY="auto"
      padding={1}
      width={compact ? "100%" : "320px"}
    >
      <Text bold={true} fg="#8be9fd">Projects</Text>
      <Box flexDirection="column" marginTop={1} minHeight={0}>
        {dashboard.projects.length === 0
          ? <Text fg="#9fb8d5">Проекты не найдены.</Text>
          : dashboard.projects.map((project, index) => (
            <Box
              key={project.id}
              marginBottom={1}
              onClick={() => {
                onSelectProject(project.id)
              }}
            >
              <Text
                bold={projectNavigationArmed && project.id === selectedProjectId}
                fg={projectNavigationArmed && project.id === selectedProjectId ? "#56f39a" : "#d6e5f7"}
              >
                {labels[index] ?? project.displayName}
              </Text>
            </Box>
          ))}
      </Box>
    </Box>
  )
}

export const OutputPanel = ({ output }: { readonly output: string }): JSX.Element => (
  <Box
    border={true}
    borderColor="#21486d"
    borderStyle="single"
    flexDirection="column"
    flexGrow={1}
    marginTop={1}
    minHeight={0}
    overflowY="auto"
    padding={1}
  >
    <Text bold={true} fg="#8be9fd">Output</Text>
    <Box flexDirection="column" marginTop={1}>
      {output.trim().length === 0
        ? <Text fg="#8fa6c4">Нет вывода. Выполни action через Enter или клик.</Text>
        : output.split("\n").slice(-18).map((line, index) => <Text key={`${index}-${line}`} fg="#d6e5f7">{line}</Text>)}
    </Box>
  </Box>
)

export const LoadingScreen = ({ apiBaseUrl }: { readonly apiBaseUrl: string }): JSX.Element => (
  <Box alignItems="center" height="100%" justifyContent="center" padding={2} width="100%">
    <Box border={true} borderColor="#39d0ff" borderStyle="rounded" flexDirection="column" padding={2}>
      <Text bold={true} fg="#f5fbff">docker-git browser</Text>
      <Text fg="#7fdfff">Подключение к API: {apiBaseUrl}</Text>
      <Text fg="#a8c0dc">Читаю controller state...</Text>
    </Box>
  </Box>
)

export const ErrorScreen = (
  { apiBaseUrl, message }: { readonly apiBaseUrl: string; readonly message: string }
): JSX.Element => (
  <Box height="100%" justifyContent="center" padding={2} width="100%">
    <Box border={true} borderColor="#ff6b7d" borderStyle="rounded" flexDirection="column" padding={2}>
      <Text bold={true} fg="#ffd8de">API недоступен</Text>
      <Text fg="#ffd166">target: {apiBaseUrl}</Text>
      <Text fg="#f2b7bf">{message}</Text>
    </Box>
  </Box>
)
