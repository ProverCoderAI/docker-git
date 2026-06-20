import type { JSX } from "react"

import type { MobileTerminalKey } from "./terminal-mobile-controls.js"
import type { TerminalExitInfo, TerminalStatus } from "./terminal-panel-runtime.js"
import type { ActiveTerminalSession } from "./terminal.js"

export type RefState<T> = { current: T }

export type TerminalNotificationHandlers = {
  readonly notifyAttachFailure: () => void
  readonly notifyExit: (info: TerminalExitInfo) => void
  readonly notifyMessage: (message: string) => void
}

export type InlineImagePreviewState = {
  readonly inlineImagePreviewsEnabled: boolean
  readonly inlineImagePreviewsEnabledRef: RefState<boolean>
  readonly toggleInlineImagePreviews: () => void
}

export type MobileTerminalControlState = {
  readonly handleMobileKeyPress: (key: MobileTerminalKey) => void
  readonly mobileControlsCollapsed: boolean
  readonly mobileCtrlArmed: boolean
  readonly toggleMobileControls: () => void
  readonly toggleMobileCtrl: () => void
}

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
  readonly onOpenVsCode?: (() => void) | undefined
}

export type TerminalPanelLayoutProps =
  & Pick<
    TerminalPanelProps,
    | "bodyContent"
    | "keyboardOpen"
    | "mobileMode"
    | "onApplyProject"
    | "onOpenBrowser"
    | "onOpenSkiller"
    | "onOpenTaskManager"
    | "onOpenTerminal"
    | "onOpenVsCode"
    | "session"
  >
  & InlineImagePreviewState
  & MobileTerminalControlState
  & {
    readonly compactHeaderMode: boolean
    readonly compactTypingMode: boolean
    readonly handleDetach: () => void
    readonly handleKill: () => void
    readonly hostRef: RefState<HTMLDivElement | null>
    readonly status: TerminalStatus
  }
