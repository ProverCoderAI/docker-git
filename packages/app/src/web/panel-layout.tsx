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
    flexDirection="column"
    padding={1}
    width={compact ? "100%" : "30%"}
  >
    <Text bold={true} fg="#8be9fd">{compact ? "docker-git menu" : "bun run docker-git"}</Text>
    <Text fg="#7ba6cc">browser inheritance shell</Text>
    <Text fg="#5bd1ff" marginTop={1}>selected project: {selectedProjectLabel}</Text>
    <Box flexDirection="column" marginTop={1}>
      {browserMenuItems.map((item, index) => (
        <Box
          key={item.tag}
          onClick={() => {
            onSelectMenu(index)
          }}
        >
          <Text bold={index === selectedMenuIndex} fg={index === selectedMenuIndex ? "#56f39a" : "#d6e5f7"}>
            {index === selectedMenuIndex ? "> " : "  "}
            {index + 1}. {compactMenuLabels[item.tag]}
          </Text>
        </Box>
      ))}
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text fg="#8fa6c4">keys:</Text>
      <Text fg="#8fa6c4">{shortcutHintText(currentMenu, projectNavigationArmed)}</Text>
      <Text fg="#8fa6c4">Enter run, R refresh, Esc cancel create</Text>
    </Box>
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
      padding={1}
      width={compact ? "100%" : "28%"}
    >
      <Text bold={true} fg="#8be9fd">Projects</Text>
      <Box flexDirection="column" marginTop={1}>
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
    marginTop={1}
    padding={1}
  >
    <Text bold={true} fg="#8be9fd">Output</Text>
    <Box flexDirection="column" marginTop={1}>
      {output.trim().length === 0
        ? <Text fg="#8fa6c4">Нет вывода. Выполни action через Enter или клик.</Text>
        : output.split("\n").slice(0, 18).map((line, index) => <Text key={`${index}-${line}`} fg="#d6e5f7">{line}
        </Text>)}
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
