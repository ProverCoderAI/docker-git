import { Effect } from "effect"
import type { JSX } from "react"
import { useEffect, useState } from "react"

import { Box, Text } from "../ui/primitives.js"
import { loadProjectTerminalSessions, type ProjectDetails, type TerminalSession } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import { terminalTitleById } from "./terminal.js"

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

type ProjectTerminalSessionHandlers = {
  readonly onAttachProjectTerminalSession: (
    projectId: string,
    projectKey: string,
    projectDisplayName: string,
    sessionId: string
  ) => void
  readonly onKillProjectTerminalSession: (projectId: string, projectKey: string, sessionId: string) => void
  readonly onOpenProjectTerminalById: (projectId: string, projectKey?: string) => void
}

type UseProjectTerminalSessionsArgs = {
  readonly currentMenu: BrowserMenuTag
  readonly dashboardRefreshTick: number
  readonly projectNavigationArmed: boolean
  readonly selectedProjectKey: string | null
}

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

const useProjectTerminalSessions = (
  args: UseProjectTerminalSessionsArgs
): readonly [ProjectTerminalSessionsState, () => void] => {
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [sessionsState, setSessionsState] = useState<ProjectTerminalSessionsState>(emptyProjectTerminalSessionsState)

  useEffect(() => {
    if (args.currentMenu !== "Select" || !args.projectNavigationArmed || args.selectedProjectKey === null) {
      setSessionsState(emptyProjectTerminalSessionsState)
      return
    }
    let cancelled = false
    setSessionsState({ error: null, loading: true, sessions: [] })
    void Effect.runPromise(
      loadProjectTerminalSessions(args.selectedProjectKey).pipe(
        Effect.match({
          onFailure: (error) => {
            if (!cancelled) {
              setSessionsState({ error, loading: false, sessions: [] })
            }
          },
          onSuccess: (sessions) => {
            if (!cancelled) {
              setSessionsState({ error: null, loading: false, sessions })
            }
          }
        })
      )
    )
    return () => {
      cancelled = true
    }
  }, [args.currentMenu, args.dashboardRefreshTick, args.projectNavigationArmed, refreshNonce, args.selectedProjectKey])

  return [sessionsState, () => {
    setRefreshNonce((value) => value + 1)
  }]
}

const ProjectTerminalSessionRow = (
  props: ProjectTerminalSessionHandlers & {
    readonly projectId: string
    readonly projectKey: string
    readonly projectName: string
    readonly session: TerminalSession
    readonly title: string
  }
): JSX.Element => (
  <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} padding={1}>
    <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
      <Text bold={true} fg="#d6e5f7">{props.title}</Text>
      <Text fg={terminalStatusColor(props.session.status)}>
        {props.session.status}
        {typeof props.session.attachedClients === "number" ? ` • clients ${props.session.attachedClients}` : ""}
      </Text>
    </Box>
    <Text fg="#8fa6c4" wrap="truncate">created: {formatSessionTime(props.session.createdAt)}</Text>
    <Text fg="#8fa6c4" wrap="truncate">started: {formatSessionTime(props.session.startedAt)}</Text>
    <Text fg="#8fa6c4" wrap="truncate">{props.session.sshCommand}</Text>
    <Box alignItems="center" flexWrap="wrap" gap={1}>
      <Box
        onClick={() => {
          props.onAttachProjectTerminalSession(props.projectId, props.projectKey, props.projectName, props.session.id)
        }}
        width="auto"
      >
        <Text bold={true} fg="#78f0a3">attach</Text>
      </Box>
      <Box
        onClick={() => {
          props.onKillProjectTerminalSession(props.projectId, props.projectKey, props.session.id)
        }}
        width="auto"
      >
        <Text bold={true} fg="#ff8aa0">kill</Text>
      </Box>
    </Box>
  </Box>
)

const ProjectTerminalSessionRows = (
  props: ProjectTerminalSessionHandlers & {
    readonly project: ProjectDetails
    readonly sessions: ReadonlyArray<TerminalSession>
  }
): JSX.Element => {
  const terminalLabels = terminalTitleById(props.sessions)
  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      {sortedTerminalSessions(props.sessions).map((session) => (
        <ProjectTerminalSessionRow
          key={session.id}
          onAttachProjectTerminalSession={props.onAttachProjectTerminalSession}
          onKillProjectTerminalSession={props.onKillProjectTerminalSession}
          onOpenProjectTerminalById={props.onOpenProjectTerminalById}
          projectId={props.project.id}
          projectKey={props.project.projectKey}
          projectName={props.project.displayName}
          session={session}
          title={terminalLabels.get(session.id) ?? "Terminal"}
        />
      ))}
    </Box>
  )
}

const ProjectTerminalSessionsSection = (
  props: ProjectTerminalSessionHandlers & {
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
            props.onOpenProjectTerminalById(props.project.id, props.project.projectKey)
          }}
          width="auto"
        >
          <Text bold={true} fg="#78f0a3">new terminal</Text>
        </Box>
        <Box onClick={props.onRefresh} width="auto">
          <Text bold={true} fg="#7fdfff">refresh</Text>
        </Box>
      </Box>
    </Box>
    {props.sessionsState.loading ? <Text fg="#8fa6c4" marginTop={1}>Loading terminal sessions...</Text> : null}
    {props.sessionsState.error === null ? null : <Text fg="#ff8aa0" marginTop={1}>{props.sessionsState.error}</Text>}
    {!props.sessionsState.loading && props.sessionsState.error === null && props.sessionsState.sessions.length === 0
      ? <Text fg="#8fa6c4" marginTop={1}>No live SSH terminals. Start one with `new terminal`.</Text>
      : null}
    <ProjectTerminalSessionRows
      onAttachProjectTerminalSession={props.onAttachProjectTerminalSession}
      onKillProjectTerminalSession={props.onKillProjectTerminalSession}
      onOpenProjectTerminalById={props.onOpenProjectTerminalById}
      project={props.project}
      sessions={props.sessionsState.sessions}
    />
  </Box>
)

export const ProjectTerminalSessionsForProject = (
  props: ProjectTerminalSessionHandlers & UseProjectTerminalSessionsArgs & {
    readonly project: ProjectDetails
  }
): JSX.Element => {
  const [sessionsState, refresh] = useProjectTerminalSessions(props)
  return (
    <ProjectTerminalSessionsSection
      onAttachProjectTerminalSession={props.onAttachProjectTerminalSession}
      onKillProjectTerminalSession={props.onKillProjectTerminalSession}
      onOpenProjectTerminalById={props.onOpenProjectTerminalById}
      onRefresh={refresh}
      project={props.project}
      sessionsState={sessionsState}
    />
  )
}
