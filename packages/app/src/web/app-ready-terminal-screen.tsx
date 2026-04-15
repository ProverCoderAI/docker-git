import type { JSX } from "react"

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

export const TerminalScreen = (props: TerminalScreenProps): JSX.Element | null => {
  if (props.terminalSession === null) {
    return null
  }
  const browserProjectId = props.terminalSession.browserProjectId
  const canOpenBrowser = canOpenProjectBrowser(props.projectBrowser, browserProjectId)
  const returnScreen: BrowserScreen = props.terminalSession.closePath.startsWith("/auth/")
    ? { tag: "Auth" }
    : projectPickerScreen()
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <TerminalPanel
        key={props.terminalSession.session.id}
        onClose={() => {
          props.onTerminalClose()
          props.onSetActiveScreen(returnScreen)
        }}
        onOpenBrowser={browserProjectId === undefined || !canOpenBrowser
          ? undefined
          : () => {
            props.onOpenProjectBrowserById(browserProjectId)
          }}
        onMessage={props.onTerminalMessage}
        session={props.terminalSession}
      />
    </Box>
  )
}
