import type { JSX } from "react"

import { ContentScreen } from "./app-ready-content-screen.js"
import type { ReadyLayoutProps } from "./app-ready-layout.js"
import { screenTitle } from "./app-ready-main-panel-labels.js"
import { MainMenuScreen } from "./app-ready-menu-screen.js"
import { ProjectPickerScreen } from "./app-ready-project-picker-screen.js"
import { ScreenFrame } from "./app-ready-screen-frame.js"
import { TerminalScreen } from "./app-ready-terminal-screen.js"
import { Box } from "./elements.js"
import { SharePanel } from "./panel-share.js"
import { OutputPanel } from "./panels.js"
import { visibleTerminalWorkspaceState } from "./terminal-state.js"

export type MainPanelsProps = Omit<ReadyLayoutProps, "busyLabel" | "message">

const MainMenuRoute = (
  props: Pick<
    MainPanelsProps,
    | "dashboard"
    | "onOpenMenuScreen"
    | "onSelectMenu"
    | "selectedMenuIndex"
    | "selectedProjectSummary"
    | "viewportLayout"
  >
): JSX.Element => (
  <ScreenFrame
    hint="↑/↓ choose, Enter open, R refresh"
    title="docker-git menu"
  >
    <MainMenuScreen {...props} />
  </ScreenFrame>
)

const OutputScreen = (props: MainPanelsProps): JSX.Element => (
  <ScreenFrame
    hint="Esc back, R reload"
    onBack={props.onBackScreen}
    title={screenTitle(props)}
  >
    <OutputPanel output={props.output} />
  </ScreenFrame>
)

const ShareScreen = (props: MainPanelsProps): JSX.Element => (
  <ScreenFrame
    hint="Esc back, R refresh"
    onBack={props.onBackScreen}
    title={screenTitle(props)}
  >
    <Box
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
      overflowY="auto"
      padding={props.viewportLayout.compact ? "6px" : 1}
    >
      <SharePanel
        onCopyPublicUrl={props.onCopyPanelShareTunnelUrl}
        onRefresh={props.onRefreshPanelShareTunnel}
        onStart={props.onStartPanelShareTunnel}
        onStop={props.onStopPanelShareTunnel}
        tunnel={props.panelCloudflareTunnel}
      />
    </Box>
  </ScreenFrame>
)

export const MainPanels = (props: MainPanelsProps): JSX.Element => {
  const visibleTerminalWorkspace = visibleTerminalWorkspaceState({
    activeTerminalSessionId: props.activeTerminalSessionId,
    terminalSessions: props.terminalSessions
  })
  if (visibleTerminalWorkspace.terminalSessions.length > 0) {
    return (
      <TerminalScreen
        {...props}
        activeTerminalSessionId={visibleTerminalWorkspace.activeTerminalSessionId}
        terminalSessions={visibleTerminalWorkspace.terminalSessions}
      />
    )
  }
  if (props.activeScreen.tag === "Menu") {
    return <MainMenuRoute {...props} />
  }
  if (props.activeScreen.tag === "ProjectPicker") {
    return <ProjectPickerScreen {...props} />
  }
  if (props.activeScreen.tag === "Output") {
    return <OutputScreen {...props} />
  }
  if (props.activeScreen.tag === "Share") {
    return <ShareScreen {...props} />
  }
  return <ContentScreen props={props} title={screenTitle(props)} />
}
