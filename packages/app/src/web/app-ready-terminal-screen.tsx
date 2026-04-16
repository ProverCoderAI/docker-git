import { Effect } from "effect"
import type { JSX } from "react"

import { deleteTerminalSessionByPath } from "./api.js"
import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"
import type { ReadyLayoutProps } from "./app-ready-layout.js"
import { Box } from "./elements.js"
import { TerminalPanel } from "./panel-terminal.js"
import { type BrowserScreen, projectPickerScreen } from "./screen.js"

type TerminalScreenProps = Pick<
  ReadyLayoutProps,
  | "onOpenProjectBrowserById"
  | "onSetActiveScreen"
  | "onTerminalClose"
  | "onTerminalMessage"
  | "projectBrowser"
  | "terminalSession"
>

const requestTerminalSessionClose = (closePath: string): void => {
  void Effect.runPromise(deleteTerminalSessionByPath(closePath).pipe(Effect.either, Effect.asVoid))
}

export const TerminalScreen = (props: TerminalScreenProps): JSX.Element | null => {
  const terminalSession = props.terminalSession
  if (terminalSession === null) {
    return null
  }
  const browserProjectId = terminalSession.browserProjectId
  const canOpenBrowser = canOpenProjectBrowser(props.projectBrowser, browserProjectId)
  const returnScreen: BrowserScreen = terminalSession.closePath.startsWith("/auth/")
    ? { tag: "Auth" }
    : projectPickerScreen()
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <TerminalPanel
        key={terminalSession.session.id}
        onClose={() => {
          requestTerminalSessionClose(terminalSession.closePath)
          props.onTerminalClose()
          props.onSetActiveScreen(returnScreen)
        }}
        onOpenBrowser={browserProjectId === undefined || !canOpenBrowser
          ? undefined
          : () => {
            props.onOpenProjectBrowserById(browserProjectId)
          }}
        onMessage={props.onTerminalMessage}
        session={terminalSession}
      />
    </Box>
  )
}
