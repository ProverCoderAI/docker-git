import type { JSX } from "react"

import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"
import { actionLabel } from "./app-ready-main-panel-labels.js"
import type { MainPanelsProps } from "./app-ready-main-panels.js"
import { Box, Text } from "./elements.js"

type ProjectActionBarProps = Pick<
  MainPanelsProps,
  | "currentMenu"
  | "onApplyAllProjects"
  | "onApplySelectedProject"
  | "onRunCurrentMenuAction"
  | "project"
  | "projectBrowser"
  | "selectedProjectSummary"
>

type ProjectGpuMode = NonNullable<MainPanelsProps["project"]>["gpu"]

const selectedProjectGpu = (
  { project, selectedProjectSummary }: Pick<ProjectActionBarProps, "project" | "selectedProjectSummary">
): ProjectGpuMode | null =>
  selectedProjectSummary !== undefined && project !== null && project.id === selectedProjectSummary.id
    ? project.gpu
    : null

type ActionButtonProps = {
  readonly fg?: string | undefined
  readonly label: string
  readonly onClick: () => void
}

const ActionButton = ({ fg = "#78f0a3", label, onClick }: ActionButtonProps): JSX.Element => (
  <Box onClick={onClick} width="auto">
    <Text bold={true} fg={fg}>{label}</Text>
  </Box>
)

const ProjectSelectionSummary = (
  props: Pick<ProjectActionBarProps, "currentMenu" | "project" | "selectedProjectSummary">
): JSX.Element => {
  const selectedGpu = selectedProjectGpu(props)
  const showGpu = props.currentMenu === "Select" && props.selectedProjectSummary !== undefined

  return (
    <Box flexDirection="column" width="auto">
      <Text fg="#aab7c4" wrap="truncate">
        {props.selectedProjectSummary === undefined ? "No project selected." : props.selectedProjectSummary.displayName}
      </Text>
      {showGpu ? <Text fg="#8fa6c4">GPU: {selectedGpu ?? "unknown"}</Text> : null}
    </Box>
  )
}

const ProjectGpuControls = (
  { onApplySelectedProject, selectedGpu }: Pick<ProjectActionBarProps, "onApplySelectedProject"> & {
    readonly selectedGpu: ProjectGpuMode | null
  }
): JSX.Element => (
  <>
    <ActionButton
      fg={selectedGpu === "all" ? "#56f39a" : "#78f0a3"}
      label="GPU on"
      onClick={() => {
        onApplySelectedProject("all")
      }}
    />
    <ActionButton
      fg={selectedGpu === "none" ? "#ffd166" : "#ffb86b"}
      label="GPU off"
      onClick={() => {
        onApplySelectedProject("none")
      }}
    />
  </>
)

const SelectProjectControls = (
  props:
    & Pick<
      ProjectActionBarProps,
      "currentMenu" | "onApplyAllProjects" | "onApplySelectedProject" | "selectedProjectSummary"
    >
    & {
      readonly selectedGpu: ProjectGpuMode | null
    }
): JSX.Element | null => {
  if (props.currentMenu !== "Select") {
    return null
  }
  return (
    <>
      {props.selectedProjectSummary === undefined
        ? null
        : <ProjectGpuControls onApplySelectedProject={props.onApplySelectedProject} selectedGpu={props.selectedGpu} />}
      {props.selectedProjectSummary === undefined
        ? null
        : (
          <ActionButton
            label="Apply"
            onClick={() => {
              props.onApplySelectedProject()
            }}
          />
        )}
      <ActionButton label="Apply all" onClick={props.onApplyAllProjects} />
    </>
  )
}

const PrimaryMenuAction = (
  props: Pick<
    ProjectActionBarProps,
    "currentMenu" | "onRunCurrentMenuAction" | "projectBrowser" | "selectedProjectSummary"
  >
): JSX.Element => {
  const label = actionLabel(props.currentMenu)
  const browserUnavailable = props.currentMenu === "Browser" &&
    !canOpenProjectBrowser(props.projectBrowser, props.selectedProjectSummary?.id ?? null)

  return browserUnavailable
    ? <Text bold={true} fg="#8fa6c4">{label}</Text>
    : <ActionButton label={label} onClick={props.onRunCurrentMenuAction} />
}

export const ProjectActionBar = (props: ProjectActionBarProps): JSX.Element => {
  const selectedGpu = selectedProjectGpu(props)

  return (
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
      <ProjectSelectionSummary
        currentMenu={props.currentMenu}
        project={props.project}
        selectedProjectSummary={props.selectedProjectSummary}
      />
      <Box flexWrap="wrap" gap={1} justifyContent="flex-end" width="auto">
        <SelectProjectControls
          currentMenu={props.currentMenu}
          onApplyAllProjects={props.onApplyAllProjects}
          onApplySelectedProject={props.onApplySelectedProject}
          selectedGpu={selectedGpu}
          selectedProjectSummary={props.selectedProjectSummary}
        />
        <PrimaryMenuAction
          currentMenu={props.currentMenu}
          onRunCurrentMenuAction={props.onRunCurrentMenuAction}
          projectBrowser={props.projectBrowser}
          selectedProjectSummary={props.selectedProjectSummary}
        />
      </Box>
    </Box>
  )
}
