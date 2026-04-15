import { Match } from "effect"
import type { JSX } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { AuthSnapshot, GithubAuthStatus, ProjectAuthSnapshot, ProjectDetails, ProjectSummary } from "./api.js"
import { Box, Text } from "./elements.js"
import type { BrowserMenuTag } from "./menu.js"
import { AuthPanel } from "./panel-auth.js"
import { CreatePanel } from "./panel-create-select.js"
import { ProjectAuthPanel } from "./panel-project-auth.js"
import { ProjectDetailsPanel, SelectPanel } from "./panel-project-details.js"

type ContentPanelProps = {
  readonly actionPrompt: ActionPromptState | null
  readonly authSnapshot: AuthSnapshot | null
  readonly compact: boolean
  readonly controllerCwd: string
  readonly projectsRoot: string
  readonly createView: CreateFlowView
  readonly currentMenu: BrowserMenuTag
  readonly githubStatus: GithubAuthStatus | null
  readonly onActionPromptCancel: () => void
  readonly onActionPromptChange: (key: string, value: string) => void
  readonly onActionPromptSubmit: () => void
  readonly onCreateBufferChange: (buffer: string) => void
  readonly onCreateCancel: () => void
  readonly onCreateSubmit: (forceWizard?: boolean) => void
  readonly onRunAuthAction: (index: number) => void
  readonly onRunProjectAuthAction: (index: number) => void
  readonly project: ProjectDetails | null
  readonly projectNavigationArmed: boolean
  readonly projectAuthSnapshot: ProjectAuthSnapshot | null
  readonly selectedProjectSummary: ProjectSummary | undefined
}

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
  | "Select"
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

const renderSelectContent = (
  currentMenu: Extract<BrowserMenuTag, "Select">,
  project: ProjectDetails | null,
  projectNavigationArmed: boolean,
  selectedProjectSummary: ProjectSummary | undefined
): JSX.Element => (
  <SelectPanel
    currentMenu={currentMenu}
    project={project}
    projectNavigationArmed={projectNavigationArmed}
    selectedProjectSummary={selectedProjectSummary}
  />
)

const renderProjectDetailsContent = (
  currentMenu: Extract<BrowserMenuTag, "Delete" | "Down" | "Info">,
  project: ProjectDetails | null,
  selectedProjectSummary: ProjectSummary | undefined
): JSX.Element => (
  <ProjectDetailsPanel
    currentMenu={currentMenu}
    project={project}
    selectedProjectSummary={selectedProjectSummary}
  />
)

const renderContentBody = (
  {
    compact,
    controllerCwd,
    createView,
    currentMenu,
    onCreateBufferChange,
    onCreateCancel,
    onCreateSubmit,
    project,
    projectNavigationArmed,
    projectsRoot,
    selectedProjectSummary
  }: Pick<
    ContentPanelProps,
    | "compact"
    | "controllerCwd"
    | "projectsRoot"
    | "createView"
    | "currentMenu"
    | "onCreateBufferChange"
    | "onCreateCancel"
    | "onCreateSubmit"
    | "project"
    | "projectNavigationArmed"
    | "selectedProjectSummary"
  >
): JSX.Element =>
  Match.value(currentMenu).pipe(
    Match.when(
      "Create",
      () => (
        <CreatePanel
          compact={compact}
          controllerCwd={controllerCwd}
          projectsRoot={projectsRoot}
          createView={createView}
          onBufferChange={onCreateBufferChange}
          onCancel={onCreateCancel}
          onSubmit={onCreateSubmit}
        />
      )
    ),
    Match.when("Select", () => renderSelectContent("Select", project, projectNavigationArmed, selectedProjectSummary)),
    Match.when("Delete", () => renderProjectDetailsContent("Delete", project, selectedProjectSummary)),
    Match.when("Down", () => renderProjectDetailsContent("Down", project, selectedProjectSummary)),
    Match.when("Info", () => renderProjectDetailsContent("Info", project, selectedProjectSummary)),
    Match.orElse((menu) => renderStaticMenuPanel(menu as StaticMenuTag))
  )

const renderAuthContent = (
  {
    actionPrompt,
    authSnapshot,
    githubStatus,
    onActionPromptCancel,
    onActionPromptChange,
    onActionPromptSubmit,
    onRunAuthAction
  }: Pick<
    ContentPanelProps,
    | "actionPrompt"
    | "authSnapshot"
    | "githubStatus"
    | "onActionPromptCancel"
    | "onActionPromptChange"
    | "onActionPromptSubmit"
    | "onRunAuthAction"
  >
): JSX.Element => (
  <AuthPanel
    actionPrompt={actionPrompt?.kind === "Auth" ? actionPrompt : null}
    githubStatus={githubStatus}
    onActionPromptCancel={onActionPromptCancel}
    onActionPromptChange={onActionPromptChange}
    onActionPromptSubmit={onActionPromptSubmit}
    onRunAuthAction={onRunAuthAction}
    snapshot={authSnapshot}
  />
)

const renderProjectAuthContent = (
  {
    actionPrompt,
    onActionPromptCancel,
    onActionPromptChange,
    onActionPromptSubmit,
    onRunProjectAuthAction,
    projectAuthSnapshot,
    selectedProjectSummary
  }: Pick<
    ContentPanelProps,
    | "actionPrompt"
    | "onActionPromptCancel"
    | "onActionPromptChange"
    | "onActionPromptSubmit"
    | "onRunProjectAuthAction"
    | "selectedProjectSummary"
    | "projectAuthSnapshot"
  >
): JSX.Element => (
  <ProjectAuthPanel
    actionPrompt={actionPrompt?.kind === "ProjectAuth" ? actionPrompt : null}
    onActionPromptCancel={onActionPromptCancel}
    onActionPromptChange={onActionPromptChange}
    onActionPromptSubmit={onActionPromptSubmit}
    onRunProjectAuthAction={onRunProjectAuthAction}
    selectedProjectName={selectedProjectSummary?.displayName ?? null}
    snapshot={projectAuthSnapshot}
  />
)

export const ContentPanel = (
  {
    actionPrompt,
    authSnapshot,
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
    projectAuthSnapshot,
    selectedProjectSummary,
    ...props
  }: ContentPanelProps
): JSX.Element => {
  if (currentMenu === "Auth") {
    return renderAuthContent({
      actionPrompt,
      authSnapshot,
      githubStatus,
      onActionPromptCancel,
      onActionPromptChange,
      onActionPromptSubmit,
      onRunAuthAction
    })
  }
  if (currentMenu === "ProjectAuth") {
    return renderProjectAuthContent({
      actionPrompt,
      onActionPromptCancel,
      onActionPromptChange,
      onActionPromptSubmit,
      onRunProjectAuthAction,
      selectedProjectSummary,
      projectAuthSnapshot
    })
  }
  return renderContentBody({
    ...props,
    currentMenu,
    onCreateBufferChange,
    onCreateCancel,
    onCreateSubmit,
    selectedProjectSummary
  })
}
