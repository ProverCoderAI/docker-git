import { Match } from "effect"
import type { JSX } from "react"

import { Box, Text } from "./elements.js"
import type { BrowserMenuTag } from "./menu.js"
import { AuthPanel } from "./panel-auth.js"
import type { ContentPanelProps } from "./panel-content-types.js"
import { CreatePanel } from "./panel-create-select.js"
import { ProjectAuthPanel } from "./panel-project-auth.js"
import { ProjectDetailsPanel, SelectPanel } from "./panel-project-details.js"

type StaticMenuTag = Exclude<
  BrowserMenuTag,
  | "Auth"
  | "Browser"
  | "Create"
  | "Databases"
  | "Delete"
  | "Down"
  | "Info"
  | "Ports"
  | "ProjectAuth"
  | "Prompts"
  | "Select"
  | "Share"
  | "Skills"
  | "Tasks"
>

const StaticActionPanel = (
  { description, title }: { readonly description: string; readonly title: string }
): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">{title}</Text>
    <Text fg="#d6e5f7">{description}</Text>
  </Box>
)

const staticPanels: Record<StaticMenuTag, { readonly description: string; readonly title: string }> = {
  DownAll: {
    description: "Press Enter to stop all projects.",
    title: "docker compose down (ALL projects)"
  },
  Logs: {
    description: "Press Enter to load docker compose logs --tail=200.",
    title: "docker compose logs"
  },
  Quit: {
    description: "Browser mode maps Quit to closing the tab.",
    title: "Quit"
  },
  Status: {
    description: "Press Enter to load docker compose ps.",
    title: "docker compose ps"
  }
}

const renderStaticMenuPanel = (currentMenu: StaticMenuTag): JSX.Element => {
  const panel = staticPanels[currentMenu]
  return <StaticActionPanel description={panel.description} title={panel.title} />
}

const renderCreateContent = (props: ContentPanelProps): JSX.Element => (
  <CreatePanel
    compact={props.compact}
    controllerCwd={props.controllerCwd}
    projectsRoot={props.projectsRoot}
    createView={props.createView}
    onBufferChange={props.onCreateBufferChange}
    onCancel={props.onCreateCancel}
    onSubmit={props.onCreateSubmit}
  />
)

const renderSelectContent = (props: ContentPanelProps): JSX.Element => (
  <SelectPanel
    currentMenu="Select"
    dashboardRefreshTick={props.dashboardRefreshTick}
    onAttachProjectTerminalSession={props.onAttachProjectTerminalSession}
    onKillProjectTerminalSession={props.onKillProjectTerminalSession}
    onOpenProjectTerminalById={props.onOpenProjectTerminalById}
    project={props.project}
    projectNavigationArmed={props.projectNavigationArmed}
    selectedProjectSummary={props.selectedProjectSummary}
  />
)

const renderProjectDetailsContent = (
  currentMenu: Extract<BrowserMenuTag, "Delete" | "Down" | "Info">,
  props: ContentPanelProps
): JSX.Element => (
  <ProjectDetailsPanel
    currentMenu={currentMenu}
    project={props.project}
    selectedProjectSummary={props.selectedProjectSummary}
  />
)

export const renderContentBody = (props: ContentPanelProps): JSX.Element =>
  Match.value(props.currentMenu).pipe(
    Match.when("Create", () => renderCreateContent(props)),
    Match.when("Select", () => renderSelectContent(props)),
    Match.when("Delete", () => renderProjectDetailsContent("Delete", props)),
    Match.when("Down", () => renderProjectDetailsContent("Down", props)),
    Match.when("Info", () => renderProjectDetailsContent("Info", props)),
    Match.orElse((menu) => renderStaticMenuPanel(menu as StaticMenuTag))
  )

export const renderAuthContent = (props: ContentPanelProps): JSX.Element => (
  <AuthPanel
    actionPrompt={props.actionPrompt?.kind === "Auth" ? props.actionPrompt : null}
    githubStatus={props.githubStatus}
    onActionPromptCancel={props.onActionPromptCancel}
    onActionPromptChange={props.onActionPromptChange}
    onActionPromptSubmit={props.onActionPromptSubmit}
    onRunAuthAction={props.onRunAuthAction}
    snapshot={props.authSnapshot}
  />
)

export const renderProjectAuthContent = (props: ContentPanelProps): JSX.Element => (
  <ProjectAuthPanel
    actionPrompt={props.actionPrompt?.kind === "ProjectAuth" ? props.actionPrompt : null}
    onActionPromptCancel={props.onActionPromptCancel}
    onActionPromptChange={props.onActionPromptChange}
    onActionPromptSubmit={props.onActionPromptSubmit}
    onRunProjectAuthAction={props.onRunProjectAuthAction}
    selectedProjectName={props.selectedProjectSummary?.displayName ?? null}
    snapshot={props.projectAuthSnapshot}
  />
)
