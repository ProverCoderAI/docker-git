import type { CSSProperties, JSX } from "react"

import type { TerminalScreenProps } from "./app-ready-terminal-types.js"
import { Box, Text } from "./elements.js"
import { terminalSessionId } from "./terminal-state.js"
import { type ActiveTerminalSession, terminalTitleById } from "./terminal.js"

type TerminalTabsProps =
  & Pick<TerminalScreenProps, "onOpenProjectTerminalById" | "onSelectTerminal" | "terminalSessions">
  & {
    readonly activeSessionId: string | null
    readonly compactMobile: boolean
  }

const mobileTabsStyle: CSSProperties = {
  display: "flex",
  flexShrink: 0,
  gap: "6px",
  minWidth: 0,
  overflowX: "auto",
  overflowY: "hidden",
  paddingBottom: "4px"
}

const fallbackTerminalTabLabel = (session: ActiveTerminalSession): string =>
  session.browserProjectName ?? session.header

const terminalTabLabel = (
  session: ActiveTerminalSession,
  labels: ReadonlyMap<string, string>
): string =>
  session.browserProjectId === undefined
    ? fallbackTerminalTabLabel(session)
    : labels.get(terminalSessionId(session)) ?? fallbackTerminalTabLabel(session)

const activeTerminalProject = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  activeSessionId: string | null
): { readonly projectId: string; readonly projectKey?: string | undefined } | null => {
  const active = sessions.find((session) => terminalSessionId(session) === activeSessionId) ?? sessions.at(-1)
  return active?.browserProjectId === undefined
    ? null
    : { projectId: active.browserProjectId, projectKey: active.browserProjectKey }
}

const TerminalTab = (
  props: {
    readonly active: boolean
    readonly compactMobile: boolean
    readonly onSelect: () => void
    readonly session: ActiveTerminalSession
    readonly terminalLabels: ReadonlyMap<string, string>
  }
): JSX.Element => (
  <Box
    backgroundColor={props.active ? "#17212b" : "#0f141a"}
    border={true}
    borderColor={props.active ? "#78f0a3" : "#3a4652"}
    maxWidth={props.compactMobile ? "44vw" : "none"}
    minWidth={0}
    onClick={props.onSelect}
    padding="6px"
    width="auto"
  >
    <Text bold={props.active} fg={props.active ? "#e8fff0" : "#9fb2c7"} wrap="truncate">
      {terminalTabLabel(props.session, props.terminalLabels)}
    </Text>
  </Box>
)

const NewTerminalButton = (
  props: Pick<TerminalTabsProps, "activeSessionId" | "compactMobile" | "onOpenProjectTerminalById" | "terminalSessions">
): JSX.Element | null => {
  const activeProject = activeTerminalProject(props.terminalSessions, props.activeSessionId)
  if (props.terminalSessions.length === 0) {
    return null
  }
  return (
    <Box
      border={true}
      borderColor="#3a4652"
      onClick={() => {
        if (activeProject !== null) {
          props.onOpenProjectTerminalById(activeProject.projectId, activeProject.projectKey)
        }
      }}
      padding="6px"
      width="auto"
    >
      <Text bold={true} fg="#78f0a3">{props.compactMobile ? "+ New" : "+ New terminal"}</Text>
    </Box>
  )
}

const TerminalTabItems = (props: TerminalTabsProps): JSX.Element => {
  const terminalLabels = terminalTitleById(props.terminalSessions.map((session) => session.session))
  return (
    <>
      {props.terminalSessions.map((session) => {
        const sessionId = terminalSessionId(session)
        return (
          <TerminalTab
            active={sessionId === props.activeSessionId}
            compactMobile={props.compactMobile}
            key={sessionId}
            onSelect={() => {
              props.onSelectTerminal(sessionId)
            }}
            session={session}
            terminalLabels={terminalLabels}
          />
        )
      })}
      <NewTerminalButton
        activeSessionId={props.activeSessionId}
        compactMobile={props.compactMobile}
        onOpenProjectTerminalById={props.onOpenProjectTerminalById}
        terminalSessions={props.terminalSessions}
      />
    </>
  )
}

export const TerminalTabs = (props: TerminalTabsProps): JSX.Element =>
  props.compactMobile
    ? (
      <div style={mobileTabsStyle}>
        <TerminalTabItems {...props} />
      </div>
    )
    : (
      <Box flexShrink={0} flexWrap="wrap" gap={1}>
        <TerminalTabItems {...props} />
      </Box>
    )
