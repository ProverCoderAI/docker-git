import { Effect } from "effect"
import type { CSSProperties, JSX } from "react"

import { deleteTerminalSessionByPath } from "./api.js"
import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"
import type { ReadyLayoutProps } from "./app-ready-layout.js"
import { Box, Text } from "./elements.js"
import { TerminalPanel } from "./panel-terminal.js"
import { type BrowserScreen, projectPickerScreen } from "./screen.js"
import { shouldShowTerminalTabs } from "./terminal-mobile-layout.js"
import { terminalSessionId } from "./terminal-state.js"
import type { ActiveTerminalSession } from "./terminal.js"

type TerminalScreenProps = Pick<
  ReadyLayoutProps,
  | "activeTerminalSessionId"
  | "onOpenProjectBrowserById"
  | "onOpenProjectTerminalById"
  | "onSelectTerminal"
  | "onSetActiveScreen"
  | "onTerminalClose"
  | "onTerminalMessage"
  | "projectBrowser"
  | "terminalSessions"
  | "viewportLayout"
>

type TerminalPaneProps =
  & Pick<
    TerminalScreenProps,
    | "onOpenProjectBrowserById"
    | "onOpenProjectTerminalById"
    | "onSetActiveScreen"
    | "onTerminalClose"
    | "onTerminalMessage"
    | "projectBrowser"
    | "viewportLayout"
  >
  & {
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
  if (
    activeTerminalSessionId !== null &&
    sessions.some((session) => terminalSessionId(session) === activeTerminalSessionId)
  ) {
    return activeTerminalSessionId
  }
  return null
}

const activeTerminalPaneStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  overflow: "hidden"
}

const terminalTabLabel = (session: ActiveTerminalSession): string => session.browserProjectName ?? session.header

const TerminalTab = (
  {
    active,
    compactMobile,
    onSelect,
    session
  }: {
    readonly active: boolean
    readonly compactMobile: boolean
    readonly onSelect: () => void
    readonly session: ActiveTerminalSession
  }
): JSX.Element => (
  <Box
    backgroundColor={active ? "#17212b" : "#0f141a"}
    border={true}
    borderColor={active ? "#78f0a3" : "#3a4652"}
    maxWidth={compactMobile ? "44vw" : "none"}
    minWidth={0}
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
    compactMobile,
    onOpenProjectTerminalById,
    onSelectTerminal,
    terminalSessions
  }: Pick<TerminalScreenProps, "onOpenProjectTerminalById" | "onSelectTerminal" | "terminalSessions"> & {
    readonly activeSessionId: string | null
    readonly compactMobile: boolean
  }
): JSX.Element => {
  if (compactMobile) {
    return (
      <div
        style={{
          display: "flex",
          flexShrink: 0,
          gap: "6px",
          minWidth: 0,
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: "4px"
        }}
      >
        {terminalSessions.map((session) => {
          const sessionId = terminalSessionId(session)
          return (
            <TerminalTab
              active={sessionId === activeSessionId}
              compactMobile={true}
              key={sessionId}
              onSelect={() => {
                onSelectTerminal(sessionId)
              }}
              session={session}
            />
          )
        })}
        {terminalSessions.length === 0
          ? null
          : (
            <Box
              border={true}
              borderColor="#3a4652"
              onClick={() => {
                const active = terminalSessions.find((session) => terminalSessionId(session) === activeSessionId) ??
                  terminalSessions.at(-1)
                const projectId = active?.browserProjectId
                const projectKey = active?.browserProjectKey
                if (projectId !== undefined) {
                  onOpenProjectTerminalById(projectId, projectKey)
                }
              }}
              padding="6px"
              width="auto"
            >
              <Text bold={true} fg="#78f0a3">+ New</Text>
            </Box>
          )}
      </div>
    )
  }

  return (
    <Box flexShrink={0} flexWrap="wrap" gap={1}>
      {terminalSessions.map((session) => {
        const sessionId = terminalSessionId(session)
        return (
          <TerminalTab
            active={sessionId === activeSessionId}
            compactMobile={false}
            key={sessionId}
            onSelect={() => {
              onSelectTerminal(sessionId)
            }}
            session={session}
          />
        )
      })}
      {terminalSessions.length === 0
        ? null
        : (
          <Box
            border={true}
            borderColor="#3a4652"
            onClick={() => {
              const active = terminalSessions.find((session) => terminalSessionId(session) === activeSessionId) ??
                terminalSessions.at(-1)
              const projectId = active?.browserProjectId
              const projectKey = active?.browserProjectKey
              if (projectId !== undefined) {
                onOpenProjectTerminalById(projectId, projectKey)
              }
            }}
            padding="6px"
            width="auto"
          >
            <Text bold={true} fg="#78f0a3">+ New terminal</Text>
          </Box>
        )}
    </Box>
  )
}

const TerminalPane = (
  {
    onOpenProjectBrowserById,
    onOpenProjectTerminalById,
    onSetActiveScreen,
    onTerminalClose,
    onTerminalMessage,
    projectBrowser,
    singleSession,
    terminalSession,
    viewportLayout
  }: TerminalPaneProps
): JSX.Element => {
  const sessionId = terminalSessionId(terminalSession)
  const browserProjectId = terminalSession.browserProjectId
  const browserProjectKey = terminalSession.browserProjectKey
  const canOpenBrowser = canOpenProjectBrowser(projectBrowser, browserProjectId)
  const detachTerminalSession = (): void => {
    onTerminalClose(sessionId)
    if (singleSession) {
      onSetActiveScreen(terminalReturnScreen(terminalSession))
    }
  }
  return (
    <div style={activeTerminalPaneStyle}>
      <TerminalPanel
        keyboardOpen={viewportLayout.keyboardOpen}
        mobileMode={viewportLayout.mode === "mobile"}
        onAttachFailure={() => {
          detachTerminalSession()
        }}
        onDetach={() => {
          detachTerminalSession()
          onTerminalMessage(`Detached SSH terminal: ${terminalSession.session.id}.`)
        }}
        onKill={() => {
          requestTerminalSessionClose(terminalSession.closePath)
          terminalSession.onExit?.()
          detachTerminalSession()
          onTerminalMessage(`Killed SSH terminal: ${terminalSession.session.id}.`)
        }}
        onOpenBrowser={browserProjectId === undefined || !canOpenBrowser
          ? undefined
          : () => {
            onOpenProjectBrowserById(browserProjectId)
          }}
        onOpenTerminal={browserProjectId === undefined
          ? undefined
          : () => {
            onOpenProjectTerminalById(browserProjectId, browserProjectKey)
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
  const mobileMode = props.viewportLayout.mode === "mobile"
  const activeSessionId = resolveActiveTerminalSessionId(props.terminalSessions, props.activeTerminalSessionId)
  const activeSession = props.terminalSessions.find((session) => terminalSessionId(session) === activeSessionId)
  return (
    <Box flexDirection="column" flexGrow={1} gap={mobileMode ? "4px" : 1} minHeight={0} overflow="hidden">
      {shouldShowTerminalTabs(mobileMode, props.terminalSessions.length)
        ? (
          <TerminalTabs
            activeSessionId={activeSessionId}
            compactMobile={mobileMode}
            onOpenProjectTerminalById={props.onOpenProjectTerminalById}
            onSelectTerminal={props.onSelectTerminal}
            terminalSessions={props.terminalSessions}
          />
        )
        : null}
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
        {activeSession === undefined
          ? null
          : (
            <TerminalPane
              key={terminalSessionId(activeSession)}
              onOpenProjectBrowserById={props.onOpenProjectBrowserById}
              onOpenProjectTerminalById={props.onOpenProjectTerminalById}
              onSetActiveScreen={props.onSetActiveScreen}
              onTerminalClose={props.onTerminalClose}
              onTerminalMessage={props.onTerminalMessage}
              projectBrowser={props.projectBrowser}
              singleSession={props.terminalSessions.length === 1}
              terminalSession={activeSession}
              viewportLayout={props.viewportLayout}
            />
          )}
      </Box>
    </Box>
  )
}
