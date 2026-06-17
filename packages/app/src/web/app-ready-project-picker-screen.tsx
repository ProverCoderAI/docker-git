import type { JSX } from "react"

import { screenTitle } from "./app-ready-main-panel-labels.js"
import type { MainPanelsProps } from "./app-ready-main-panels.js"
import { ProjectActionBar } from "./app-ready-project-action-bar.js"
import { ScreenFrame } from "./app-ready-screen-frame.js"
import { Box } from "./elements.js"
import { BrowserPanel } from "./panel-browser.js"
import { ContentPanel } from "./panel-content.js"
import { DatabasePanel } from "./panel-databases.js"
import { PortForwardPanel } from "./panel-port-forwards.js"
import { ProjectDetailsPanel } from "./panel-project-details.js"
import { ProjectPromptsPanel } from "./panel-project-prompts.js"
import { ProjectSkillsPanel } from "./panel-project-skills.js"
import { TaskPanel } from "./panel-tasks.js"
import { ProjectListPanel } from "./panels.js"

type ProjectDetailsRenderer = (props: MainPanelsProps) => JSX.Element

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

const ProjectPromptsDetails = (props: MainPanelsProps): JSX.Element => (
  <ProjectPromptsPanel
    onDeletePrompt={props.onDeleteProjectPrompt}
    onRefreshPrompts={props.onRefreshProjectPrompts}
    onSavePrompt={props.onSaveProjectPrompt}
    selectedProjectSummary={props.selectedProjectSummary}
    snapshot={props.projectPrompts}
  />
)

const ProjectSkillsDetails = (props: MainPanelsProps): JSX.Element => (
  <ProjectSkillsPanel
    onDeleteSkill={props.onDeleteProjectSkill}
    onRefreshSkills={props.onRefreshProjectSkills}
    onSaveSkill={props.onSaveProjectSkill}
    selectedProjectSummary={props.selectedProjectSummary}
    snapshot={props.projectSkills}
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
    creationView={props.creationView}
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

const projectDetailsRenderers: Partial<Record<MainPanelsProps["currentMenu"], ProjectDetailsRenderer>> = {
  Browser: BrowserDetails,
  Databases: DatabaseDetails,
  Ports: PortForwardDetails,
  Prompts: ProjectPromptsDetails,
  Skills: ProjectSkillsDetails,
  Tasks: TaskDetails
}

const projectInfoDetailMenus: ReadonlySet<MainPanelsProps["currentMenu"]> = new Set([
  "Logs",
  "ProjectAuth",
  "Status"
])

const resolveProjectPickerDetails = (
  currentMenu: MainPanelsProps["currentMenu"]
): ProjectDetailsRenderer => {
  const renderer = projectDetailsRenderers[currentMenu]
  if (renderer !== undefined) {
    return renderer
  }
  return projectInfoDetailMenus.has(currentMenu) ? ProjectInfoDetails : ProjectContentDetails
}

const ProjectPickerDetails = (props: MainPanelsProps): JSX.Element => {
  const Details = resolveProjectPickerDetails(props.currentMenu)
  return <Details {...props} />
}

const ProjectPickerDetailsFrame = (props: MainPanelsProps): JSX.Element => (
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
)

const ProjectPickerBody = (props: MainPanelsProps): JSX.Element => (
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
      <ProjectPickerDetailsFrame {...props} />
    </Box>
    <ProjectActionBar
      currentMenu={props.currentMenu}
      onApplyAllProjects={props.onApplyAllProjects}
      onApplySelectedProject={props.onApplySelectedProject}
      onRunCurrentMenuAction={props.onRunCurrentMenuAction}
      project={props.project}
      projectBrowser={props.projectBrowser}
      selectedProjectSummary={props.selectedProjectSummary}
    />
  </Box>
)

export const ProjectPickerScreen = (props: MainPanelsProps): JSX.Element => (
  <ScreenFrame
    hint="↑/↓ project, Enter run, Esc back"
    onBack={props.onBackScreen}
    title={screenTitle(props)}
  >
    <ProjectPickerBody {...props} />
  </ScreenFrame>
)
