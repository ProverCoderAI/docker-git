import type { JSX } from "react"

import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"
import { ContentScreen } from "./app-ready-content-screen.js"
import type { ReadyLayoutProps } from "./app-ready-layout.js"
import { MainMenuScreen } from "./app-ready-menu-screen.js"
import { ScreenFrame } from "./app-ready-screen-frame.js"
import { TerminalScreen } from "./app-ready-terminal-screen.js"
import { Box, Text } from "./elements.js"
import { BrowserPanel } from "./panel-browser.js"
import { ContentPanel } from "./panel-content.js"
import { DatabasePanel } from "./panel-databases.js"
import { PortForwardPanel } from "./panel-port-forwards.js"
import { ProjectDetailsPanel } from "./panel-project-details.js"
import { TaskPanel } from "./panel-tasks.js"
import { OutputPanel, ProjectListPanel } from "./panels.js"
import { visibleTerminalWorkspaceState } from "./terminal-state.js"

export type MainPanelsProps = Omit<ReadyLayoutProps, "busyLabel" | "message">

const actionLabels: Record<MainPanelsProps["currentMenu"], string> = {
  Auth: "Run",
  Browser: "Open browser",
  Create: "Run",
  Databases: "Open SQL editor",
  Delete: "Delete project",
  Down: "Stop project",
  DownAll: "Run",
  Info: "Run",
  Logs: "Load logs",
  Ports: "Open port",
  ProjectAuth: "Open project auth",
  Quit: "Run",
  Select: "Open SSH",
  Status: "Load status",
  Tasks: "Refresh tasks"
}

const actionLabel = (menu: MainPanelsProps["currentMenu"]): string => actionLabels[menu]

const screenTitle = (props: Pick<MainPanelsProps, "activeScreen" | "currentMenu">): string => {
  if (props.activeScreen.tag === "Create") {
    return "docker-git / Create"
  }
  if (props.activeScreen.tag === "Auth") {
    return "docker-git / Auth profiles"
  }
  if (props.activeScreen.tag === "ProjectAuth") {
    return "docker-git / Project auth"
  }
  if (props.activeScreen.tag === "Output") {
    return props.currentMenu === "Logs" ? "docker compose logs" : "docker compose ps"
  }
  if (props.activeScreen.tag === "ProjectPicker") {
    return `docker-git / ${actionLabel(props.currentMenu)}`
  }
  return "docker-git"
}

const MainMenuRoute = (
  props: Pick<
    MainPanelsProps,
    | "dashboard"
    | "onOpenMenuScreen"
    | "onSelectMenu"
    | "selectedMenuIndex"
    | "selectedProjectSummary"
    | "viewportLayout"
  >
): JSX.Element => (
  <ScreenFrame
    hint="↑/↓ choose, Enter open, R refresh"
    title="docker-git menu"
  >
    <MainMenuScreen {...props} />
  </ScreenFrame>
)

const ProjectActionBar = (
  {
    currentMenu,
    onRunCurrentMenuAction,
    projectBrowser,
    selectedProjectSummary
  }: Pick<MainPanelsProps, "currentMenu" | "onRunCurrentMenuAction" | "projectBrowser" | "selectedProjectSummary">
): JSX.Element => (
  <Box
    alignItems="center"
    border={true}
    borderColor="#3a4652"
    flexShrink={0}
    flexWrap="wrap"
    gap={1}
    justifyContent="space-between"
    padding={1}
  >
    <Text fg="#aab7c4" wrap="truncate">
      {selectedProjectSummary === undefined ? "No project selected." : selectedProjectSummary.displayName}
    </Text>
    {currentMenu === "Browser" && !canOpenProjectBrowser(projectBrowser, selectedProjectSummary?.id ?? null)
      ? <Text bold={true} fg="#8fa6c4">{actionLabel(currentMenu)}</Text>
      : (
        <Box onClick={onRunCurrentMenuAction} width="auto">
          <Text bold={true} fg="#78f0a3">{actionLabel(currentMenu)}</Text>
        </Box>
      )}
  </Box>
)

const PortForwardDetails = (props: MainPanelsProps): JSX.Element => (
  <PortForwardPanel
    forwards={props.portForwards}
    input={props.portForwardInput}
    onCloseForward={props.onCloseProjectPortForward}
    onInputChange={props.onPortForwardInputChange}
    onOpenForward={props.onOpenProjectPortForward}
    onRefreshForwards={props.onRefreshProjectPortForwards}
    project={props.project}
    selectedProjectSummary={props.selectedProjectSummary}
  />
)

const BrowserDetails = (props: MainPanelsProps): JSX.Element => (
  <BrowserPanel
    browser={props.projectBrowser}
    onOpenBrowser={props.onOpenProjectBrowser}
    onRefreshBrowser={props.onRefreshProjectBrowser}
    selectedProjectSummary={props.selectedProjectSummary}
  />
)

const DatabaseDetails = (props: MainPanelsProps): JSX.Element => (
  <DatabasePanel
    connectionInput={props.databaseConnectionInput}
    forwards={props.databaseForwards}
    labelInput={props.databaseLabelInput}
    onConnectionInputChange={props.onDatabaseConnectionInputChange}
    onCloseForward={props.onCloseDatabaseForward}
    onDeleteProfile={props.onDeleteDatabaseProfile}
    onExposeProfile={props.onExposeDatabaseProfile}
    onLabelInputChange={props.onDatabaseLabelInputChange}
    onOpenEditor={props.onOpenProjectDatabaseEditor}
    onRefreshDatabases={props.onRefreshProjectDatabases}
    onRestartEditor={props.onRestartProjectDatabaseEditor}
    onSaveProfile={props.onSaveDatabaseProfile}
    profiles={props.databaseProfiles}
    project={props.project}
    selectedProjectSummary={props.selectedProjectSummary}
    session={props.databaseSession}
  />
)

const TaskDetails = (props: MainPanelsProps): JSX.Element => (
  <TaskPanel
    includeDefault={props.projectTasksIncludeDefault}
    logs={props.projectTaskLogs}
    onIncludeDefaultChange={props.onProjectTasksIncludeDefaultChange}
    onLoadLogs={props.onLoadProjectTaskLogs}
    onRefreshTasks={props.onRefreshProjectTasks}
    onStopTask={props.onStopProjectTask}
    project={props.project}
    selectedProjectSummary={props.selectedProjectSummary}
    snapshot={props.projectTasks}
  />
)

const ProjectInfoDetails = (props: MainPanelsProps): JSX.Element => (
  <ProjectDetailsPanel
    currentMenu="Info"
    project={props.project}
    selectedProjectSummary={props.selectedProjectSummary}
  />
)

const ProjectContentDetails = (props: MainPanelsProps): JSX.Element => (
  <ContentPanel
    actionPrompt={props.actionPrompt}
    authSnapshot={props.authSnapshot}
    compact={props.viewportLayout.compact}
    controllerCwd={props.controllerCwd}
    createView={props.createView}
    currentMenu={props.currentMenu}
    dashboardRefreshTick={props.dashboardRefreshTick}
    githubStatus={props.githubStatus}
    onActionPromptCancel={props.onActionPromptCancel}
    onActionPromptChange={props.onActionPromptChange}
    onActionPromptSubmit={props.onActionPromptSubmit}
    onAttachProjectTerminalSession={props.onAttachProjectTerminalSession}
    onCreateBufferChange={props.onCreateBufferChange}
    onCreateCancel={props.onCreateCancel}
    onCreateSubmit={props.onCreateSubmit}
    onKillProjectTerminalSession={props.onKillProjectTerminalSession}
    onOpenProjectTerminalById={props.onOpenProjectTerminalById}
    onRunAuthAction={props.onRunAuthAction}
    onRunProjectAuthAction={props.onRunProjectAuthAction}
    project={props.project}
    projectAuthSnapshot={props.projectAuthSnapshot}
    projectNavigationArmed={true}
    projectsRoot={props.projectsRoot}
    selectedProjectSummary={props.selectedProjectSummary}
  />
)

const ProjectPickerDetails = (props: MainPanelsProps): JSX.Element => {
  if (props.currentMenu === "Ports") {
    return <PortForwardDetails {...props} />
  }
  if (props.currentMenu === "Browser") {
    return <BrowserDetails {...props} />
  }
  if (props.currentMenu === "Databases") {
    return <DatabaseDetails {...props} />
  }
  if (props.currentMenu === "Tasks") {
    return <TaskDetails {...props} />
  }
  if (props.currentMenu === "ProjectAuth" || props.currentMenu === "Logs" || props.currentMenu === "Status") {
    return <ProjectInfoDetails {...props} />
  }
  return <ProjectContentDetails {...props} />
}

const ProjectPickerScreen = (props: MainPanelsProps): JSX.Element => (
  <ScreenFrame
    hint="↑/↓ project, Enter run, Esc back"
    onBack={props.onBackScreen}
    title={screenTitle(props)}
  >
    <Box flexDirection="column" flexGrow={1} gap={1} minHeight={0} overflow="hidden">
      <Box
        flexDirection={props.viewportLayout.compact ? "column" : "row"}
        flexGrow={1}
        gap={1}
        minHeight={0}
        overflow="hidden"
      >
        <ProjectListPanel
          compact={props.viewportLayout.compact}
          currentMenu={props.currentMenu}
          dashboard={props.dashboard}
          onBack={props.onBackScreen}
          onRunCurrentMenuAction={props.onRunCurrentMenuAction}
          onSelectProject={props.onSelectProject}
          onProjectSearchQueryChange={props.onProjectSearchQueryChange}
          projectNavigationArmed={true}
          projectSearchQuery={props.projectSearchQuery}
          selectedProjectId={props.selectedProjectId}
        />
        <Box
          border={true}
          borderColor="#3a4652"
          flexDirection="column"
          flexGrow={1}
          minHeight={0}
          minWidth={0}
          overflowY="auto"
          padding={1}
        >
          <ProjectPickerDetails {...props} />
        </Box>
      </Box>
      <ProjectActionBar
        currentMenu={props.currentMenu}
        onRunCurrentMenuAction={props.onRunCurrentMenuAction}
        projectBrowser={props.projectBrowser}
        selectedProjectSummary={props.selectedProjectSummary}
      />
    </Box>
  </ScreenFrame>
)

const OutputScreen = (props: MainPanelsProps): JSX.Element => (
  <ScreenFrame
    hint="Esc back, R reload"
    onBack={props.onBackScreen}
    title={screenTitle(props)}
  >
    <OutputPanel output={props.output} />
  </ScreenFrame>
)

export const MainPanels = (props: MainPanelsProps): JSX.Element => {
  const visibleTerminalWorkspace = visibleTerminalWorkspaceState({
    activeTerminalSessionId: props.activeTerminalSessionId,
    terminalSessions: props.terminalSessions
  })
  if (visibleTerminalWorkspace.terminalSessions.length > 0) {
    return (
      <TerminalScreen
        {...props}
        activeTerminalSessionId={visibleTerminalWorkspace.activeTerminalSessionId}
        terminalSessions={visibleTerminalWorkspace.terminalSessions}
      />
    )
  }
  if (props.activeScreen.tag === "Menu") {
    return <MainMenuRoute {...props} />
  }
  if (props.activeScreen.tag === "ProjectPicker") {
    return <ProjectPickerScreen {...props} />
  }
  if (props.activeScreen.tag === "Output") {
    return <OutputScreen {...props} />
  }
  return <ContentScreen props={props} title={screenTitle(props)} />
}
