import { Effect } from "effect"
import type { CSSProperties, JSX } from "react"

import { deleteTerminalSessionByPath } from "./api.js"
import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"
import type { ReadyLayoutProps } from "./app-ready-layout.js"
import { Box, Text } from "./elements.js"
import { TerminalPanel } from "./panel-terminal.js"
import { type BrowserScreen, projectPickerScreen } from "./screen.js"
import { terminalSessionId } from "./terminal-state.js"
import type { ActiveTerminalSession } from "./terminal.js"

type TerminalScreenProps = Pick<
  ReadyLayoutProps,
  | "activeTerminalSessionId"
  | "onOpenProjectBrowserById"
  | "onSelectTerminal"
  | "onSetActiveScreen"
  | "onTerminalClose"
  | "onTerminalMessage"
  | "projectBrowser"
  | "terminalSessions"
>

type TerminalPaneProps =
  & Pick<
    TerminalScreenProps,
    | "onOpenProjectBrowserById"
    | "onSetActiveScreen"
    | "onTerminalClose"
    | "onTerminalMessage"
    | "projectBrowser"
  >
  & {
    readonly active: boolean
    readonly singleSession: boolean
    readonly terminalSession: ActiveTerminalSession
  }

const requestTerminalSessionClose = (closePath: string): void => {
  void Effect.runPromise(deleteTerminalSessionByPath(closePath).pipe(Effect.either, Effect.asVoid))
}

const terminalReturnScreen = (session: ActiveTerminalSession): BrowserScreen =>
  session.closePath.startsWith("/auth/") ? { tag: "Auth" } : projectPickerScreen()

const resolveActiveTerminalSessionId = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  activeTerminalSessionId: string | null
): string | null => {
  if (sessions.some((session) => terminalSessionId(session) === activeTerminalSessionId)) {
    return activeTerminalSessionId
  }
  const first = sessions[0]
  return first === undefined ? null : terminalSessionId(first)
}

const terminalPaneStyle = (active: boolean): CSSProperties => ({
  display: active ? "flex" : "none",
  flex: 1,
  minHeight: 0,
  overflow: "hidden"
})

const terminalTabLabel = (session: ActiveTerminalSession): string => session.browserProjectName ?? session.header

const TerminalTab = (
  {
    active,
    onSelect,
    session
  }: {
    readonly active: boolean
    readonly onSelect: () => void
    readonly session: ActiveTerminalSession
  }
): JSX.Element => (
  <Box
    backgroundColor={active ? "#17212b" : "#0f141a"}
    border={true}
    borderColor={active ? "#78f0a3" : "#3a4652"}
    onClick={onSelect}
    padding="6px"
    width="auto"
  >
    <Text bold={active} fg={active ? "#e8fff0" : "#9fb2c7"} wrap="truncate">
      {terminalTabLabel(session)}
    </Text>
  </Box>
)

const TerminalTabs = (
  {
    activeSessionId,
    onSelectTerminal,
    terminalSessions
  }: Pick<TerminalScreenProps, "onSelectTerminal" | "terminalSessions"> & {
    readonly activeSessionId: string | null
  }
): JSX.Element => (
  <Box flexShrink={0} flexWrap="wrap" gap={1}>
    {terminalSessions.map((session) => {
      const sessionId = terminalSessionId(session)
      return (
        <TerminalTab
          active={sessionId === activeSessionId}
          key={sessionId}
          onSelect={() => {
            onSelectTerminal(sessionId)
          }}
          session={session}
        />
      )
    })}
  </Box>
)

const TerminalPane = (
  {
    active,
    onOpenProjectBrowserById,
    onSetActiveScreen,
    onTerminalClose,
    onTerminalMessage,
    projectBrowser,
    singleSession,
    terminalSession
  }: TerminalPaneProps
): JSX.Element => {
  const sessionId = terminalSessionId(terminalSession)
  const browserProjectId = terminalSession.browserProjectId
  const canOpenBrowser = canOpenProjectBrowser(projectBrowser, browserProjectId)
  return (
    <div style={terminalPaneStyle(active)}>
      <TerminalPanel
        onClose={() => {
          requestTerminalSessionClose(terminalSession.closePath)
          onTerminalClose(sessionId)
          if (singleSession) {
            onSetActiveScreen(terminalReturnScreen(terminalSession))
          }
        }}
        onOpenBrowser={browserProjectId === undefined || !canOpenBrowser
          ? undefined
          : () => {
            onOpenProjectBrowserById(browserProjectId)
          }}
        onMessage={onTerminalMessage}
        session={terminalSession}
      />
    </div>
  )
}

export const TerminalScreen = (props: TerminalScreenProps): JSX.Element | null => {
  if (props.terminalSessions.length === 0) {
    return null
  }
  const activeSessionId = resolveActiveTerminalSessionId(props.terminalSessions, props.activeTerminalSessionId)
  return (
    <Box flexDirection="column" flexGrow={1} gap={1} minHeight={0} overflow="hidden">
      <TerminalTabs
        activeSessionId={activeSessionId}
        onSelectTerminal={props.onSelectTerminal}
        terminalSessions={props.terminalSessions}
      />
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
        {props.terminalSessions.map((terminalSession) => {
          const sessionId = terminalSessionId(terminalSession)
          return (
            <TerminalPane
              active={sessionId === activeSessionId}
              key={sessionId}
              onOpenProjectBrowserById={props.onOpenProjectBrowserById}
              onSetActiveScreen={props.onSetActiveScreen}
              onTerminalClose={props.onTerminalClose}
              onTerminalMessage={props.onTerminalMessage}
              projectBrowser={props.projectBrowser}
              singleSession={props.terminalSessions.length === 1}
              terminalSession={terminalSession}
            />
          )
        })}
      </Box>
    </Box>
  )
}
