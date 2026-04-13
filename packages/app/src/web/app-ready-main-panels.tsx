import type { JSX } from "react"

import type { ReadyLayoutProps } from "./app-ready-layout.js"
import { Box } from "./elements.js"
import { TerminalPanel } from "./panel-terminal.js"
import {
  ContentPanel,
  MenuSidebar,
  OutputPanel,
  ProjectListPanel,
  projectSelectionLabel,
  showsProjectPanel
} from "./panels.js"

type MainPanelsProps = Omit<ReadyLayoutProps, "busyLabel" | "message">

type CenterPanelProps =
  & Pick<
    MainPanelsProps,
    | "actionPrompt"
    | "authSnapshot"
    | "compact"
    | "createView"
    | "controllerCwd"
    | "projectsRoot"
    | "currentMenu"
    | "githubStatus"
    | "onActionPromptCancel"
    | "onActionPromptChange"
    | "onActionPromptSubmit"
    | "onCreateBufferChange"
    | "onCreateCancel"
    | "onCreateSubmit"
    | "onRunAuthAction"
    | "onRunProjectAuthAction"
    | "onTerminalClose"
    | "onTerminalMessage"
    | "output"
    | "project"
    | "projectNavigationArmed"
    | "projectAuthSnapshot"
    | "selectedProjectSummary"
    | "terminalSession"
  >
  & {
    readonly showProjectPanel: boolean
  }

type CenterPanelBodyProps = Pick<
  CenterPanelProps,
  "onTerminalClose" | "onTerminalMessage" | "output" | "terminalSession"
>

type CenterPanelContentProps = Pick<
  CenterPanelProps,
  | "actionPrompt"
  | "authSnapshot"
  | "compact"
  | "controllerCwd"
  | "createView"
  | "currentMenu"
  | "githubStatus"
  | "onActionPromptCancel"
  | "onActionPromptChange"
  | "onActionPromptSubmit"
  | "onCreateBufferChange"
  | "onCreateCancel"
  | "onCreateSubmit"
  | "onRunAuthAction"
  | "onRunProjectAuthAction"
  | "project"
  | "projectAuthSnapshot"
  | "projectNavigationArmed"
  | "projectsRoot"
  | "selectedProjectSummary"
>

const CenterPanelBody = (
  { onTerminalClose, onTerminalMessage, output, terminalSession }: CenterPanelBodyProps
): JSX.Element =>
  terminalSession === null
    ? <OutputPanel output={output} />
    : (
      <TerminalPanel
        key={terminalSession.session.id}
        onClose={onTerminalClose}
        onMessage={(message) => {
          onTerminalMessage(message)
        }}
        session={terminalSession}
      />
    )

const CenterPanelContent = (
  {
    actionPrompt,
    authSnapshot,
    compact,
    controllerCwd,
    createView,
    currentMenu,
    githubStatus,
    onActionPromptCancel,
    onActionPromptChange,
    onActionPromptSubmit,
    onCreateBufferChange,
    onCreateCancel,
    onCreateSubmit,
    onRunAuthAction,
    onRunProjectAuthAction,
    project,
    projectAuthSnapshot,
    projectNavigationArmed,
    projectsRoot,
    selectedProjectSummary
  }: CenterPanelContentProps
): JSX.Element => (
  <ContentPanel
    actionPrompt={actionPrompt}
    authSnapshot={authSnapshot}
    compact={compact}
    controllerCwd={controllerCwd}
    createView={createView}
    currentMenu={currentMenu}
    githubStatus={githubStatus}
    onActionPromptCancel={onActionPromptCancel}
    onActionPromptChange={onActionPromptChange}
    onActionPromptSubmit={onActionPromptSubmit}
    onCreateBufferChange={onCreateBufferChange}
    onCreateCancel={onCreateCancel}
    onCreateSubmit={onCreateSubmit}
    onRunAuthAction={onRunAuthAction}
    onRunProjectAuthAction={onRunProjectAuthAction}
    project={project}
    projectAuthSnapshot={projectAuthSnapshot}
    projectNavigationArmed={projectNavigationArmed}
    projectsRoot={projectsRoot}
    selectedProjectSummary={selectedProjectSummary}
  />
)

const centerPanelWidth = (compact: boolean, showProjectPanel: boolean): string => {
  if (compact) {
    return "100%"
  }
  return showProjectPanel ? "42%" : "69%"
}

const CenterPanel = (props: CenterPanelProps): JSX.Element => (
  <Box
    border={true}
    borderColor="#24537d"
    borderStyle="single"
    flexDirection="column"
    padding={1}
    width={centerPanelWidth(props.compact, props.showProjectPanel)}
  >
    <CenterPanelContent {...props} />
    <CenterPanelBody {...props} />
  </Box>
)

const ProjectPanelSlot = (
  {
    compact,
    currentMenu,
    dashboard,
    onSelectProject,
    projectNavigationArmed,
    selectedProjectId,
    showProjectPanel
  }:
    & Pick<
      MainPanelsProps,
      "compact" | "currentMenu" | "dashboard" | "onSelectProject" | "projectNavigationArmed" | "selectedProjectId"
    >
    & {
      readonly showProjectPanel: boolean
    }
): JSX.Element | null =>
  showProjectPanel
    ? (
      <ProjectListPanel
        compact={compact}
        currentMenu={currentMenu}
        dashboard={dashboard}
        onSelectProject={onSelectProject}
        projectNavigationArmed={projectNavigationArmed}
        selectedProjectId={selectedProjectId}
      />
    )
    : null

const MainCenterPanel = (
  {
    props,
    selectedProjectSummary,
    showProjectPanel
  }: {
    readonly props: Omit<MainPanelsProps, "selectedProjectSummary">
    readonly selectedProjectSummary: MainPanelsProps["selectedProjectSummary"]
    readonly showProjectPanel: boolean
  }
): JSX.Element => (
  <CenterPanel
    actionPrompt={props.actionPrompt}
    authSnapshot={props.authSnapshot}
    compact={props.compact}
    controllerCwd={props.controllerCwd}
    projectsRoot={props.projectsRoot}
    createView={props.createView}
    currentMenu={props.currentMenu}
    githubStatus={props.githubStatus}
    onActionPromptCancel={props.onActionPromptCancel}
    onActionPromptChange={props.onActionPromptChange}
    onActionPromptSubmit={props.onActionPromptSubmit}
    onCreateBufferChange={props.onCreateBufferChange}
    onCreateCancel={props.onCreateCancel}
    onCreateSubmit={props.onCreateSubmit}
    onRunAuthAction={props.onRunAuthAction}
    onRunProjectAuthAction={props.onRunProjectAuthAction}
    onTerminalClose={props.onTerminalClose}
    onTerminalMessage={props.onTerminalMessage}
    output={props.output}
    project={props.project}
    projectAuthSnapshot={props.projectAuthSnapshot}
    projectNavigationArmed={props.projectNavigationArmed}
    selectedProjectSummary={selectedProjectSummary}
    showProjectPanel={showProjectPanel}
    terminalSession={props.terminalSession}
  />
)

export const MainPanels = ({ selectedProjectSummary, ...props }: MainPanelsProps): JSX.Element => {
  const showProject = showsProjectPanel(props.currentMenu)
  return (
    <Box flexDirection={props.compact ? "column" : "row"} flexGrow={1} gap={1}>
      <MenuSidebar
        compact={props.compact}
        currentMenu={props.currentMenu}
        onSelectMenu={props.onSelectMenu}
        projectNavigationArmed={props.projectNavigationArmed}
        selectedMenuIndex={props.selectedMenuIndex}
        selectedProjectLabel={projectSelectionLabel(selectedProjectSummary)}
      />
      <MainCenterPanel props={props} selectedProjectSummary={selectedProjectSummary} showProjectPanel={showProject} />
      <ProjectPanelSlot
        compact={props.compact}
        currentMenu={props.currentMenu}
        dashboard={props.dashboard}
        onSelectProject={props.onSelectProject}
        projectNavigationArmed={props.projectNavigationArmed}
        selectedProjectId={props.selectedProjectId}
        showProjectPanel={showProject}
      />
    </Box>
  )
}
