import type { JSX } from "react"

import { buildSelectLabels, type SelectPurpose } from "../docker-git/menu-select-presenter.js"
import { TextInput } from "../ui/primitives.js"
import type { DashboardData } from "./api.js"
import { Box, Text } from "./elements.js"
import type { BrowserMenuTag } from "./menu.js"
import { selectPurposeForMenu } from "./panel-project-details.js"
import { filterDashboardProjectsByQuery } from "./project-search.js"

type ProjectListPanelProps = {
  readonly compact: boolean
  readonly currentMenu: BrowserMenuTag
  readonly dashboard: DashboardData
  readonly onBack: () => void
  readonly onRunCurrentMenuAction: () => void
  readonly onSelectProject: (projectId: string) => void
  readonly onProjectSearchQueryChange: (value: string) => void
  readonly projectNavigationArmed: boolean
  readonly projectSearchQuery: string
  readonly selectedProjectId: string | null
}

type ProjectListModel = {
  readonly filteredDashboard: DashboardData
  readonly labels: ReadonlyArray<string>
  readonly noProjectLabel: string
}

export const isProjectPanelShown = (currentMenu: BrowserMenuTag): boolean => currentMenu === "Select"

const renderListPurpose = (currentMenu: BrowserMenuTag): SelectPurpose => selectPurposeForMenu(currentMenu) ?? "Connect"

const projectPanelMaxHeight = (isCompact: boolean): string => isCompact ? "30%" : "100%"

const runtimeByProject = (dashboard: DashboardData) =>
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
  isProjectNavigationArmed: boolean,
  selectedProjectId: string | null
): number =>
  !isProjectPanelShown(currentMenu) || isProjectNavigationArmed
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

const projectListModel = (props: ProjectListPanelProps): ProjectListModel => {
  const filteredDashboard = filterDashboardProjectsByQuery(props.dashboard, props.projectSearchQuery)
  const selectedIndex = resolveProjectListSelectionIndex(
    props.currentMenu,
    filteredDashboard,
    props.projectNavigationArmed,
    props.selectedProjectId
  )
  return {
    filteredDashboard,
    labels: buildProjectListLabels(props.currentMenu, filteredDashboard, selectedIndex),
    noProjectLabel: props.dashboard.projects.length === 0
      ? "Проекты не найдены."
      : `No projects match "${props.projectSearchQuery}".`
  }
}

const ProjectListHeader = (
  { filteredCount, totalCount }: { readonly filteredCount: number; readonly totalCount: number }
): JSX.Element => (
  <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
    <Text bold={true} fg="#8be9fd">Projects</Text>
    <Text fg="#8fa6c4">{filteredCount}/{totalCount}</Text>
  </Box>
)

const ProjectSearchInput = (
  {
    onBack,
    onProjectSearchQueryChange,
    onRunCurrentMenuAction,
    projectSearchQuery
  }: Pick<
    ProjectListPanelProps,
    "onBack" | "onProjectSearchQueryChange" | "onRunCurrentMenuAction" | "projectSearchQuery"
  >
): JSX.Element => (
  <Box flexDirection="column" gap="4px" marginTop={1}>
    <Text fg="#8fa6c4">Search container/project</Text>
    <TextInput
      ariaLabel="Search projects by container or project name"
      onChange={onProjectSearchQueryChange}
      onEnter={() => {
        onRunCurrentMenuAction()
      }}
      onEscape={() => {
        if (projectSearchQuery.length === 0) {
          onBack()
          return
        }
        onProjectSearchQueryChange("")
      }}
      placeholder="container, repo, branch"
      value={projectSearchQuery}
    />
  </Box>
)

const ProjectRows = (
  {
    labels,
    model,
    onSelectProject,
    projectNavigationArmed,
    selectedProjectId
  }: Pick<ProjectListPanelProps, "onSelectProject" | "projectNavigationArmed" | "selectedProjectId"> & {
    readonly labels: ReadonlyArray<string>
    readonly model: ProjectListModel
  }
): JSX.Element => (
  <Box flexDirection="column" marginTop={1} minHeight={0}>
    {model.filteredDashboard.projects.length === 0
      ? <Text fg="#9fb8d5">{model.noProjectLabel}</Text>
      : model.filteredDashboard.projects.map((project, index) => (
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
)

export const ProjectListPanel = (props: ProjectListPanelProps): JSX.Element => {
  const model = projectListModel(props)
  return (
    <Box
      border={true}
      borderColor="#3a4652"
      borderStyle="single"
      flexDirection="column"
      flexShrink={props.compact ? 1 : 0}
      maxHeight={projectPanelMaxHeight(props.compact)}
      minHeight={0}
      overflowY="auto"
      padding={1}
      width={props.compact ? "100%" : "320px"}
    >
      <ProjectListHeader
        filteredCount={model.filteredDashboard.projects.length}
        totalCount={props.dashboard.projects.length}
      />
      <ProjectSearchInput {...props} />
      <ProjectRows
        labels={model.labels}
        model={model}
        onSelectProject={props.onSelectProject}
        projectNavigationArmed={props.projectNavigationArmed}
        selectedProjectId={props.selectedProjectId}
      />
    </Box>
  )
}
