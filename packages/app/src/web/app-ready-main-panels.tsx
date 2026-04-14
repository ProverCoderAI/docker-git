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
    | "viewportLayout"
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
  | "viewportLayout"
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
    selectedProjectSummary,
    viewportLayout
  }: CenterPanelContentProps
): JSX.Element => (
  <ContentPanel
    actionPrompt={actionPrompt}
    authSnapshot={authSnapshot}
    compact={viewportLayout.compact}
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
  return showProjectPanel ? "48%" : "auto"
}

const CenterPanel = (props: CenterPanelProps): JSX.Element => (
  <Box
    border={true}
    borderColor="#24537d"
    borderStyle="single"
    flexDirection="column"
    flexGrow={1}
    minHeight={0}
    minWidth={0}
    overflow="hidden"
    padding={1}
    width={centerPanelWidth(props.viewportLayout.compact, props.showProjectPanel)}
  >
    <Box
      flexDirection="column"
      flexShrink={0}
      maxHeight={props.viewportLayout.dense ? "38%" : "46%"}
      overflowY="auto"
    >
      <CenterPanelContent {...props} />
    </Box>
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <CenterPanelBody {...props} />
    </Box>
  </Box>
)

const ProjectPanelSlot = (
  {
    currentMenu,
    dashboard,
    onSelectProject,
    projectNavigationArmed,
    selectedProjectId,
    showProjectPanel,
    viewportLayout
  }:
    & Pick<
      MainPanelsProps,
      | "currentMenu"
      | "dashboard"
      | "onSelectProject"
      | "projectNavigationArmed"
      | "selectedProjectId"
      | "viewportLayout"
    >
    & {
      readonly showProjectPanel: boolean
    }
): JSX.Element | null =>
  showProjectPanel
    ? (
      <ProjectListPanel
        compact={viewportLayout.compact}
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
    viewportLayout={props.viewportLayout}
  />
)

export const MainPanels = ({ selectedProjectSummary, ...props }: MainPanelsProps): JSX.Element => {
  const showProject = showsProjectPanel(props.currentMenu)
  return (
    <Box
      flexDirection={props.viewportLayout.compact ? "column" : "row"}
      flexGrow={1}
      gap={1}
      minHeight={0}
      overflow="hidden"
    >
      <MenuSidebar
        compact={props.viewportLayout.compact}
        currentMenu={props.currentMenu}
        onSelectMenu={props.onSelectMenu}
        projectNavigationArmed={props.projectNavigationArmed}
        selectedMenuIndex={props.selectedMenuIndex}
        selectedProjectLabel={projectSelectionLabel(selectedProjectSummary)}
      />
      <MainCenterPanel props={props} selectedProjectSummary={selectedProjectSummary} showProjectPanel={showProject} />
      <ProjectPanelSlot
        currentMenu={props.currentMenu}
        dashboard={props.dashboard}
        onSelectProject={props.onSelectProject}
        projectNavigationArmed={props.projectNavigationArmed}
        selectedProjectId={props.selectedProjectId}
        showProjectPanel={showProject}
        viewportLayout={props.viewportLayout}
      />
    </Box>
  )
}
