import { Effect, Match } from "effect"
import type { JSX } from "react"
import { useEffect, useState } from "react"

import {
  buildSelectDetailsModel,
  selectHint,
  type SelectPurpose,
  selectTitle,
  stoppedRuntime
} from "../docker-git/menu-select-presenter.js"
import { Box, Text } from "../ui/primitives.js"
import { HelpLines } from "../ui/shared.js"
import { loadProjectTerminalSessions, type ProjectDetails, type ProjectSummary, type TerminalSession } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"

type ProjectTerminalSessionsState = {
  readonly error: string | null
  readonly loading: boolean
  readonly sessions: ReadonlyArray<TerminalSession>
}

const emptyProjectTerminalSessionsState: ProjectTerminalSessionsState = {
  error: null,
  loading: false,
  sessions: []
}

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

const formatSessionTime = (value: string | undefined): string =>
  value === undefined ? "pending" : value.replace("T", " ").replace(/\.000Z$/u, " UTC")

const terminalStatusColor = (status: TerminalSession["status"]): string => {
  if (status === "attached") {
    return "#56f39a"
  }
  if (status === "failed") {
    return "#ff8aa0"
  }
  if (status === "exited") {
    return "#ffd166"
  }
  return "#8fd3ff"
}

const sortedTerminalSessions = (
  sessions: ReadonlyArray<TerminalSession>
): ReadonlyArray<TerminalSession> => sessions.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))

const ProjectTerminalSessionRow = (
  {
    onAttachProjectTerminalSession,
    onKillProjectTerminalSession,
    projectId,
    projectKey,
    projectName,
    session
  }: {
    readonly onAttachProjectTerminalSession: (
      projectId: string,
      projectKey: string,
      projectDisplayName: string,
      sessionId: string
    ) => void
    readonly onKillProjectTerminalSession: (projectId: string, projectKey: string, sessionId: string) => void
    readonly projectId: string
    readonly projectKey: string
    readonly projectName: string
    readonly session: TerminalSession
  }
): JSX.Element => (
  <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} padding={1}>
    <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
      <Text bold={true} fg="#d6e5f7">session {session.id.slice(0, 12)}</Text>
      <Text fg={terminalStatusColor(session.status)}>
        {session.status}
        {typeof session.attachedClients === "number" ? ` • clients ${session.attachedClients}` : ""}
      </Text>
    </Box>
    <Text fg="#8fa6c4" wrap="truncate">created: {formatSessionTime(session.createdAt)}</Text>
    <Text fg="#8fa6c4" wrap="truncate">started: {formatSessionTime(session.startedAt)}</Text>
    <Text fg="#8fa6c4" wrap="truncate">{session.sshCommand}</Text>
    <Box alignItems="center" flexWrap="wrap" gap={1}>
      <Box
        onClick={() => {
          onAttachProjectTerminalSession(projectId, projectKey, projectName, session.id)
        }}
        width="auto"
      >
        <Text bold={true} fg="#78f0a3">attach</Text>
      </Box>
      <Box
        onClick={() => {
          onKillProjectTerminalSession(projectId, projectKey, session.id)
        }}
        width="auto"
      >
        <Text bold={true} fg="#ff8aa0">kill</Text>
      </Box>
    </Box>
  </Box>
)

const ProjectTerminalSessionsSection = (
  {
    onAttachProjectTerminalSession,
    onKillProjectTerminalSession,
    onOpenProjectTerminalById,
    onRefresh,
    project,
    sessionsState
  }: {
    readonly onAttachProjectTerminalSession: (
      projectId: string,
      projectKey: string,
      projectDisplayName: string,
      sessionId: string
    ) => void
    readonly onKillProjectTerminalSession: (projectId: string, projectKey: string, sessionId: string) => void
    readonly onOpenProjectTerminalById: (projectId: string, projectKey?: string) => void
    readonly onRefresh: () => void
    readonly project: ProjectDetails
    readonly sessionsState: ProjectTerminalSessionsState
  }
): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
      <Text bold={true} fg="#8be9fd">Live terminal sessions</Text>
      <Box alignItems="center" flexWrap="wrap" gap={1}>
        <Box
          onClick={() => {
            onOpenProjectTerminalById(project.id, project.projectKey)
          }}
          width="auto"
        >
          <Text bold={true} fg="#78f0a3">new terminal</Text>
        </Box>
        <Box onClick={onRefresh} width="auto">
          <Text bold={true} fg="#7fdfff">refresh</Text>
        </Box>
      </Box>
    </Box>
    {sessionsState.loading ? <Text fg="#8fa6c4" marginTop={1}>Loading terminal sessions...</Text> : null}
    {sessionsState.error === null ? null : <Text fg="#ff8aa0" marginTop={1}>{sessionsState.error}</Text>}
    {!sessionsState.loading && sessionsState.error === null && sessionsState.sessions.length === 0
      ? <Text fg="#8fa6c4" marginTop={1}>No live SSH terminals. Start one with `new terminal`.</Text>
      : null}
    <Box flexDirection="column" gap={1} marginTop={1}>
      {sortedTerminalSessions(sessionsState.sessions).map((session) => (
        <ProjectTerminalSessionRow
          key={session.id}
          onAttachProjectTerminalSession={onAttachProjectTerminalSession}
          onKillProjectTerminalSession={onKillProjectTerminalSession}
          projectId={project.id}
          projectKey={project.projectKey}
          projectName={project.displayName}
          session={session}
        />
      ))}
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
    dashboardRefreshTick,
    onAttachProjectTerminalSession,
    onKillProjectTerminalSession,
    onOpenProjectTerminalById,
    project,
    projectNavigationArmed,
    selectedProjectSummary
  }: {
    readonly currentMenu: BrowserMenuTag
    readonly dashboardRefreshTick: number
    readonly onAttachProjectTerminalSession: (
      projectId: string,
      projectKey: string,
      projectDisplayName: string,
      sessionId: string
    ) => void
    readonly onKillProjectTerminalSession: (projectId: string, projectKey: string, sessionId: string) => void
    readonly onOpenProjectTerminalById: (projectId: string, projectKey?: string) => void
    readonly project: ProjectDetails | null
    readonly projectNavigationArmed: boolean
    readonly selectedProjectSummary: ProjectSummary | undefined
  }
): JSX.Element | null => {
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [sessionsState, setSessionsState] = useState<ProjectTerminalSessionsState>(emptyProjectTerminalSessionsState)
  const selectedProjectKey = selectedProjectSummary?.projectKey ?? null

  useEffect(() => {
    if (currentMenu !== "Select" || !projectNavigationArmed || selectedProjectKey === null) {
      setSessionsState(emptyProjectTerminalSessionsState)
      return
    }
    let cancelled = false
    setSessionsState((current) => ({
      error: null,
      loading: true,
      sessions: current.sessions
    }))
    void Effect.runPromise(
      loadProjectTerminalSessions(selectedProjectKey).pipe(
        Effect.match({
          onFailure: (error) => {
            if (cancelled) {
              return
            }
            setSessionsState({
              error,
              loading: false,
              sessions: []
            })
          },
          onSuccess: (sessions) => {
            if (cancelled) {
              return
            }
            setSessionsState({
              error: null,
              loading: false,
              sessions
            })
          }
        })
      )
    )
    return () => {
      cancelled = true
    }
  }, [currentMenu, dashboardRefreshTick, projectNavigationArmed, refreshNonce, selectedProjectKey])

  if (currentMenu !== "Select") {
    return null
  }
  if (!projectNavigationArmed) {
    return renderInactiveSelection()
  }
  if (project === null || (selectedProjectSummary !== undefined && project.id !== selectedProjectSummary.id)) {
    return renderPendingSelection("Connect", selectedProjectSummary)
  }
  return (
    <Box flexDirection="column">
      {renderDetailsPanel("Connect", project, selectedProjectSummary)}
      <ProjectTerminalSessionsSection
        onAttachProjectTerminalSession={onAttachProjectTerminalSession}
        onKillProjectTerminalSession={onKillProjectTerminalSession}
        onOpenProjectTerminalById={onOpenProjectTerminalById}
        onRefresh={() => {
          setRefreshNonce((value) => value + 1)
        }}
        project={project}
        sessionsState={sessionsState}
      />
    </Box>
  )
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
