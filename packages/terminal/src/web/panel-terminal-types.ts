import type { JSX } from "react"

import type { TerminalExitInfo } from "./terminal-panel-runtime.js"
import type { ActiveTerminalSession } from "./terminal.js"

export type TerminalPanelProps = {
  readonly keyboardOpen: boolean
  readonly mobileMode: boolean
  readonly onAttachFailure: () => void
  readonly onApplyProject?: (() => void) | undefined
  readonly onDetach: () => void
  readonly onExit?: ((info: TerminalExitInfo) => void) | undefined
  readonly onKill: () => void
  readonly onMessage: (message: string) => void
  readonly onOpenBrowser?: (() => void) | undefined
  readonly onOpenSkiller?: (() => void) | undefined
  readonly onOpenTaskManager?: (() => void) | undefined
  readonly onOpenTerminal?: (() => void) | undefined
  readonly session: ActiveTerminalSession
  readonly bodyContent?: JSX.Element | undefined
}
