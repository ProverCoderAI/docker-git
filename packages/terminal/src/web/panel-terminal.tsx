import "xterm/css/xterm.css"

import { type JSX, useCallback, useEffect, useRef, useState } from "react"

import { TerminalHeader } from "./panel-terminal-header.js"
import {
  MobileTerminalControls,
  retainTerminalFocus,
  sendMobileCtrlEventInput,
  sendTerminalMobileInput,
  shouldKeepMobileCtrlArmed
} from "./panel-terminal-mobile-controls.js"
import {
  terminalBodyContentStyle,
  terminalBodyFrameStyle,
  terminalHostStyle,
  terminalPanelStyle
} from "./panel-terminal-styles.js"
import type { TerminalPanelProps } from "./panel-terminal-types.js"
import type { MobileTerminalKey } from "./terminal-mobile-controls.js"
import { resolveTerminalCompactHeaderMode, resolveTerminalTypingMode } from "./terminal-mobile-layout.js"
import {
  type TerminalConnectionState,
  type TerminalExitInfo,
  type TerminalInputController,
  type TerminalStatus,
  useTerminalSessionLifecycle
} from "./terminal-panel-runtime.js"
import { type ActiveTerminalSession, isPendingActiveTerminalSession } from "./terminal.js"

type RefState<T> = { current: T }

type TerminalNotificationHandlers = {
  readonly notifyAttachFailure: () => void
  readonly notifyExit: (info: TerminalExitInfo) => void
  readonly notifyMessage: (message: string) => void
}

type InlineImagePreviewState = {
  readonly inlineImagePreviewsEnabled: boolean
  readonly inlineImagePreviewsEnabledRef: RefState<boolean>
  readonly toggleInlineImagePreviews: () => void
}

type MobileTerminalControlState = {
  readonly handleMobileKeyPress: (key: MobileTerminalKey) => void
  readonly mobileControlsCollapsed: boolean
  readonly mobileCtrlArmed: boolean
  readonly toggleMobileControls: () => void
  readonly toggleMobileCtrl: () => void
}

type TerminalPanelLayoutProps =
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

const resolveInitialTerminalStatus = (session: ActiveTerminalSession): TerminalStatus =>
  isPendingActiveTerminalSession(session) && session.pendingConnection.phase === "error" ? "error" : "connecting"

const useTerminalNotificationHandlers = (
  { onAttachFailure, onExit, onMessage }: Pick<TerminalPanelProps, "onAttachFailure" | "onExit" | "onMessage">
): TerminalNotificationHandlers => {
  const onAttachFailureRef = useRef(onAttachFailure)
  const onExitRef = useRef(onExit)
  const onMessageRef = useRef(onMessage)
  useEffect(() => {
    onAttachFailureRef.current = onAttachFailure
  }, [onAttachFailure])
  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])
  return {
    notifyAttachFailure: useCallback(() => {
      onAttachFailureRef.current()
    }, []),
    notifyExit: useCallback((info: TerminalExitInfo) => {
      onExitRef.current?.(info)
    }, []),
    notifyMessage: useCallback((message: string) => {
      onMessageRef.current(message)
    }, [])
  }
}

const useInlineImagePreviewState = (
  runtimeRef: RefState<TerminalInputController | null>,
  terminalSessionId: string
): InlineImagePreviewState => {
  const inlineImagePreviewsEnabledRef = useRef(true)
  const [isInlineImagePreviewsEnabled, setInlineImagePreviewsEnabled] = useState(true)
  useEffect(() => {
    inlineImagePreviewsEnabledRef.current = true
    setInlineImagePreviewsEnabled(true)
  }, [terminalSessionId])
  const toggleInlineImagePreviews = useCallback(() => {
    setInlineImagePreviewsEnabled((current) => {
      const isNext = !current
      inlineImagePreviewsEnabledRef.current = isNext
      return isNext
    })
    retainTerminalFocus(runtimeRef.current)
  }, [runtimeRef])

  return {
    inlineImagePreviewsEnabled: isInlineImagePreviewsEnabled,
    inlineImagePreviewsEnabledRef,
    toggleInlineImagePreviews
  }
}

const useMobileCtrlKeyboard = (
  {
    hostRef,
    mobileCtrlArmed,
    mobileMode,
    runtimeRef,
    setMobileCtrlArmed
  }: {
    readonly hostRef: RefState<HTMLDivElement | null>
    readonly mobileCtrlArmed: boolean
    readonly mobileMode: boolean
    readonly runtimeRef: RefState<TerminalInputController | null>
    readonly setMobileCtrlArmed: (armed: boolean) => void
  }
): void => {
  useEffect(() => {
    if (!mobileMode || !mobileCtrlArmed || hostRef.current === null) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMobileCtrlArmed(false)
        return
      }
      if (shouldKeepMobileCtrlArmed(event)) {
        return
      }
      setMobileCtrlArmed(false)
      sendMobileCtrlEventInput(runtimeRef.current, event)
    }
    const host = hostRef.current
    host.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => {
      host.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [hostRef, mobileCtrlArmed, mobileMode, runtimeRef, setMobileCtrlArmed])
}

const useMobileTerminalControlState = (
  mobileMode: boolean,
  hostRef: RefState<HTMLDivElement | null>,
  runtimeRef: RefState<TerminalInputController | null>
): MobileTerminalControlState => {
  const [isMobileControlsCollapsed, setMobileControlsCollapsed] = useState(false)
  const [isMobileCtrlArmed, setMobileCtrlArmed] = useState(false)
  useEffect(() => {
    if (mobileMode) {
      return
    }

    setMobileControlsCollapsed(false)
    setMobileCtrlArmed(false)
  }, [mobileMode])
  useMobileCtrlKeyboard({ hostRef, mobileCtrlArmed: isMobileCtrlArmed, mobileMode, runtimeRef, setMobileCtrlArmed })
  const handleMobileKeyPress = useCallback((key: MobileTerminalKey) => {
    if (key === "ctrl-c") {
      setMobileCtrlArmed(false)
    }
    sendTerminalMobileInput(runtimeRef.current, key)
  }, [runtimeRef])
  const toggleMobileControls = useCallback(() => {
    setMobileControlsCollapsed((current) => !current)
    setMobileCtrlArmed(false)
    retainTerminalFocus(runtimeRef.current)
  }, [runtimeRef])
  const toggleMobileCtrl = useCallback(() => {
    setMobileCtrlArmed((current) => !current)
    retainTerminalFocus(runtimeRef.current)
  }, [runtimeRef])

  return {
    handleMobileKeyPress,
    mobileControlsCollapsed: isMobileControlsCollapsed,
    mobileCtrlArmed: isMobileCtrlArmed,
    toggleMobileControls,
    toggleMobileCtrl
  }
}

const useTerminalCloseActions = (
  connectionRef: RefState<TerminalConnectionState>,
  onDetach: () => void,
  onKill: () => void
): { readonly handleDetach: () => void; readonly handleKill: () => void } => ({
  handleDetach: useCallback(() => {
    connectionRef.current.closing = true
    onDetach()
  }, [connectionRef, onDetach]),
  handleKill: useCallback(() => {
    connectionRef.current.closing = true
    onKill()
  }, [connectionRef, onKill])
})

const TerminalPanelBody = (
  {
    bodyContent,
    compactTypingMode,
    hostRef,
    mobileMode
  }: Pick<TerminalPanelLayoutProps, "bodyContent" | "compactTypingMode" | "hostRef" | "mobileMode">
): JSX.Element => (
  <div style={terminalBodyFrameStyle(compactTypingMode, mobileMode)}>
    <div ref={hostRef} style={terminalHostStyle} />
    {bodyContent === undefined ? null : <div style={terminalBodyContentStyle}>{bodyContent}</div>}
  </div>
)

const TerminalPanelMobileControls = (props: TerminalPanelLayoutProps): JSX.Element | null =>
  props.mobileMode && props.bodyContent === undefined
    ? (
      <MobileTerminalControls
        collapsed={props.mobileControlsCollapsed}
        compactTypingMode={props.compactTypingMode}
        ctrlArmed={props.mobileCtrlArmed}
        onKeyPress={props.handleMobileKeyPress}
        onToggleCollapsed={props.toggleMobileControls}
        onToggleCtrl={props.toggleMobileCtrl}
      />
    )
    : null

const TerminalPanelLayout = (props: TerminalPanelLayoutProps): JSX.Element => (
  <div style={terminalPanelStyle(props.mobileMode, props.keyboardOpen)}>
    <TerminalHeader
      compactHeaderMode={props.compactHeaderMode}
      inlineImagePreviewsEnabled={props.inlineImagePreviewsEnabled}
      onApplyProject={props.onApplyProject}
      onDetach={props.handleDetach}
      onKill={props.handleKill}
      onOpenBrowser={props.onOpenBrowser}
      onOpenSkiller={props.onOpenSkiller}
      onOpenTaskManager={props.onOpenTaskManager}
      onOpenTerminal={props.onOpenTerminal}
      onToggleInlineImagePreviews={props.toggleInlineImagePreviews}
      session={props.session}
      status={props.status}
    />
    <TerminalPanelBody
      bodyContent={props.bodyContent}
      compactTypingMode={props.compactTypingMode}
      hostRef={props.hostRef}
      mobileMode={props.mobileMode}
    />
    <TerminalPanelMobileControls {...props} />
  </div>
)

export const TerminalPanel = (props: TerminalPanelProps): JSX.Element => {
  const connectionRef = useRef<TerminalConnectionState>({ closing: false, opened: false })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<TerminalInputController | null>(null)
  const [status, setStatus] = useState<TerminalStatus>(() => resolveInitialTerminalStatus(props.session))
  const isCompactHeaderMode = resolveTerminalCompactHeaderMode(props.mobileMode)
  const isCompactTypingMode = resolveTerminalTypingMode(props.mobileMode, props.keyboardOpen)
  const terminalSessionId = props.session.session.id
  const notifications = useTerminalNotificationHandlers(props)
  const inlineImageState = useInlineImagePreviewState(runtimeRef, terminalSessionId)
  const mobileControlState = useMobileTerminalControlState(props.mobileMode, hostRef, runtimeRef)
  const closeActions = useTerminalCloseActions(connectionRef, props.onDetach, props.onKill)

  useEffect(() => {
    setStatus(resolveInitialTerminalStatus(props.session))
  }, [props.session])
  useTerminalSessionLifecycle({
    connectionRef,
    hostRef,
    inlineImagePreviewsEnabledRef: inlineImageState.inlineImagePreviewsEnabledRef,
    notifyExit: notifications.notifyExit,
    notifyMessage: notifications.notifyMessage,
    onAttachFailure: notifications.notifyAttachFailure,
    runtimeRef,
    session: props.session,
    setStatus
  })

  return (
    <TerminalPanelLayout
      {...props}
      {...closeActions}
      {...inlineImageState}
      {...mobileControlState}
      compactHeaderMode={isCompactHeaderMode}
      compactTypingMode={isCompactTypingMode}
      hostRef={hostRef}
      status={status}
    />
  )
}
