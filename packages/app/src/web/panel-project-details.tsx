import { Match } from "effect"
import type { JSX } from "react"

import {
  buildSelectDetailsModel,
  selectHint,
  type SelectPurpose,
  selectTitle,
  stoppedRuntime
} from "../docker-git/menu-select-presenter.js"
import { Box, Text } from "../ui/primitives.js"
import { HelpLines } from "../ui/shared.js"
import type { ProjectDetails, ProjectSummary } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"

const toSelectPurpose = (menu: BrowserMenuTag): SelectPurpose | null =>
  Match.value(menu).pipe(
    Match.when("Delete", () => "Delete" as const),
    Match.when("Down", () => "Down" as const),
    Match.when("Info", () => "Info" as const),
    Match.when("ProjectAuth", () => "Auth" as const),
    Match.when("Select", () => "Connect" as const),
    Match.orElse(() => null)
  )

const runtimeFromProject = (
  project: Pick<ProjectSummary, "startedAtEpochMs" | "startedAtIso" | "sshSessions" | "status"> | null
) =>
  project === null
    ? stoppedRuntime()
    : {
      running: project.status === "running",
      sshSessions: project.sshSessions,
      startedAtIso: project.startedAtIso,
      startedAtEpochMs: project.startedAtEpochMs
    }

const renderSelectLines = (lines: ReadonlyArray<string>): ReadonlyArray<JSX.Element> =>
  lines.map((line, index) => <Text key={`${index}-${line}`} fg="#d6e5f7">{line}</Text>)

const renderPendingSelection = (
  purpose: SelectPurpose,
  selectedProjectSummary: ProjectSummary | undefined
): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">{selectTitle(purpose)}</Text>
    <Box flexDirection="column" marginTop={1}>
      <Text fg="#d6e5f7">
        {selectedProjectSummary === undefined
          ? "No project selected."
          : `Selected: ${selectedProjectSummary.displayName}`}
      </Text>
      {selectedProjectSummary === undefined
        ? null
        : (
          <Box flexDirection="column">
            <Text fg="#d6e5f7">State: {selectedProjectSummary.statusLabel}</Text>
            <Text fg="#8fa6c4">Loading project details...</Text>
          </Box>
        )}
    </Box>
    <Text fg="#8fa6c4" marginTop={1}>{selectHint(purpose, false)}</Text>
  </Box>
)

const renderInactiveSelection = (): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">{selectTitle("Connect")}</Text>
    <Box flexDirection="column" marginTop={1}>
      <Text fg="#d6e5f7">Project selection is not active yet.</Text>
      <Text fg="#8fa6c4">Press Enter or → to choose a project, then use ↑/↓ and Enter to run.</Text>
    </Box>
  </Box>
)

const renderMissingProject = (purpose: SelectPurpose): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">{selectTitle(purpose)}</Text>
    <Box flexDirection="column" marginTop={1}>
      <Text fg="#d6e5f7">No project selected.</Text>
      <Text fg="#8fa6c4">Open Select first, choose a project there, then return to this tab.</Text>
    </Box>
  </Box>
)

const renderDetailsPanel = (
  purpose: SelectPurpose,
  project: ProjectDetails,
  selectedProjectSummary: ProjectSummary | undefined
): JSX.Element => {
  const details = buildSelectDetailsModel(
    purpose,
    project,
    runtimeFromProject(selectedProjectSummary ?? project),
    false
  )

  return (
    <Box flexDirection="column">
      <Text bold={true} fg="#8be9fd">{details.title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {renderSelectLines(details.lines)}
      </Box>
      <HelpLines lines={[selectHint(purpose, false)]} />
    </Box>
  )
}

export const SelectPanel = (
  {
    currentMenu,
    project,
    projectNavigationArmed,
    selectedProjectSummary
  }: {
    readonly currentMenu: BrowserMenuTag
    readonly project: ProjectDetails | null
    readonly projectNavigationArmed: boolean
    readonly selectedProjectSummary: ProjectSummary | undefined
  }
): JSX.Element | null => {
  if (currentMenu !== "Select") {
    return null
  }
  if (!projectNavigationArmed) {
    return renderInactiveSelection()
  }
  if (project === null || (selectedProjectSummary !== undefined && project.id !== selectedProjectSummary.id)) {
    return renderPendingSelection("Connect", selectedProjectSummary)
  }
  return renderDetailsPanel("Connect", project, selectedProjectSummary)
}

export const ProjectDetailsPanel = (
  {
    currentMenu,
    project,
    selectedProjectSummary
  }: {
    readonly currentMenu: Extract<BrowserMenuTag, "Delete" | "Down" | "Info">
    readonly project: ProjectDetails | null
    readonly selectedProjectSummary: ProjectSummary | undefined
  }
): JSX.Element => {
  const purpose = toSelectPurpose(currentMenu) ?? "Info"
  if (selectedProjectSummary === undefined) {
    return renderMissingProject(purpose)
  }
  if (project === null || project.id !== selectedProjectSummary.id) {
    return renderPendingSelection(purpose, selectedProjectSummary)
  }
  return renderDetailsPanel(purpose, project, selectedProjectSummary)
}

export const selectPurposeForMenu = toSelectPurpose
