import "xterm/css/xterm.css"

import { type CSSProperties, type JSX, useCallback, useEffect, useRef, useState } from "react"

import {
  isModifierOnlyTerminalKey,
  type MobileTerminalKey,
  mobileTerminalKeyInput,
  terminalControlCharacterForKey
} from "./terminal-mobile-controls.js"
import { resolveTerminalCompactHeaderMode, resolveTerminalTypingMode } from "./terminal-mobile-layout.js"
import {
  type TerminalConnectionState,
  type TerminalExitInfo,
  type TerminalInputController,
  type TerminalStatus,
  useTerminalSessionLifecycle
} from "./terminal-panel-runtime.js"
import { type ActiveTerminalSession, isPendingActiveTerminalSession } from "./terminal.js"

type TerminalPanelProps = {
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

const panelStyle: CSSProperties = {
  border: "1px solid #3a4652",
  borderRadius: "8px",
  display: "flex",
  flex: 1,
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden"
}

const terminalPanelStyle = (mobileMode: boolean, keyboardOpen: boolean): CSSProperties => ({
  ...panelStyle,
  marginTop: mobileMode || keyboardOpen ? 0 : "8px"
})

const headerStyle: CSSProperties = {
  alignItems: "stretch",
  background: "#101419",
  borderBottom: "1px solid #3a4652",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  justifyContent: "flex-start",
  padding: "10px 12px"
}

const compactHeaderStyle: CSSProperties = {
  ...headerStyle,
  alignItems: "center",
  flexDirection: "row",
  flexWrap: "wrap",
  gap: "6px",
  overflow: "visible",
  padding: "5px 6px"
}

const bodyStyle: CSSProperties = {
  background: "#080a0d",
  flex: 1,
  minHeight: 0,
  padding: "8px"
}

const bodyStyleMobile: CSSProperties = {
  ...bodyStyle,
  padding: "2px"
}

const bodyStyleKeyboardOpen: CSSProperties = {
  ...bodyStyle,
  padding: 0
}

const terminalBodyStyle = (compactTypingMode: boolean, mobileMode: boolean): CSSProperties => {
  if (compactTypingMode) {
    return bodyStyleKeyboardOpen
  }
  return mobileMode ? bodyStyleMobile : bodyStyle
}

const terminalBodyFrameStyle = (compactTypingMode: boolean, mobileMode: boolean): CSSProperties => ({
  ...terminalBodyStyle(compactTypingMode, mobileMode),
  boxSizing: "border-box",
  overflow: "hidden",
  position: "relative"
})

const terminalHostStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  overflow: "hidden"
}

const terminalBodyContentStyle: CSSProperties = {
  bottom: 0,
  height: "100%",
  left: 0,
  minHeight: 0,
  overflow: "auto",
  position: "absolute",
  right: 0,
  top: 0,
  zIndex: 1
}

const closeButtonStyle: CSSProperties = {
  background: "#171d24",
  border: "1px solid #3a4652",
  borderRadius: "8px",
  color: "#d6e5f7",
  cursor: "pointer",
  font: "inherit",
  padding: "6px 10px"
}

const compactCloseButtonStyle: CSSProperties = {
  ...closeButtonStyle,
  fontSize: "11px",
  padding: "4px 6px"
}

const headerActionsStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexShrink: 0,
  flexWrap: "wrap",
  gap: "8px",
  justifyContent: "flex-start",
  width: "100%"
}

const compactHeaderActionsStyle: CSSProperties = {
  ...headerActionsStyle,
  flexWrap: "wrap",
  gap: "4px",
  justifyContent: "flex-end",
  marginLeft: "auto",
  width: "auto"
}

const mobileControlsCollapsedStyle: CSSProperties = {
  alignItems: "center",
  background: "#0d1218",
  borderTop: "1px solid #3a4652",
  display: "flex",
  flexShrink: 0,
  justifyContent: "flex-end",
  padding: "8px"
}

const mobileControlsStyle: CSSProperties = {
  background: "#0d1218",
  borderTop: "1px solid #3a4652",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  gap: "8px",
  padding: "8px"
}

const mobileControlsRowStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))"
}

const mobileArrowRowStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))"
}

const mobileControlButtonStyle = (
  active = false
): CSSProperties => ({
  background: active ? "#1d3550" : "#121a23",
  border: `1px solid ${active ? "#78f0a3" : "#3a4652"}`,
  borderRadius: "8px",
  color: active ? "#e8fff0" : "#d6e5f7",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  minHeight: "40px",
  padding: "8px 10px"
})

const statusColor = (status: TerminalStatus): string => {
  if (status === "attached") {
    return "#56f39a"
  }
  if (status === "error") {
    return "#ff8f8f"
  }
  if (status === "exited") {
    return "#ffd166"
  }
  return "#8fd3ff"
}

const compactHeaderTitleStyle: CSSProperties = {
  color: "#f6fbff",
  flex: 1,
  fontWeight: 700,
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

const compactStatusStyle = (status: TerminalStatus): CSSProperties => ({
  color: statusColor(status),
  flexShrink: 0,
  fontSize: "11px",
  whiteSpace: "nowrap"
})

const headerTitleStyle: CSSProperties = {
  color: "#f6fbff",
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

const headerStatusStyle = (status: TerminalStatus): CSSProperties => ({
  color: statusColor(status),
  whiteSpace: "nowrap"
})

const headerSubtitleStyle: CSSProperties = {
  color: "#8fa6c4",
  fontSize: "12px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

const resolveInitialTerminalStatus = (session: ActiveTerminalSession): TerminalStatus =>
  isPendingActiveTerminalSession(session) && session.pendingConnection.phase === "error" ? "error" : "connecting"

const TerminalHeaderTitle = (
  {
    compactHeaderMode,
    session,
    status
  }: Pick<TerminalPanelProps, "session"> & {
    readonly compactHeaderMode: boolean
    readonly status: TerminalStatus
  }
): JSX.Element =>
  compactHeaderMode
    ? (
      <div style={{ alignItems: "center", display: "flex", gap: "6px", minWidth: 0 }}>
        <div style={compactHeaderTitleStyle}>
          {session.browserProjectName ?? session.header}
        </div>
        <div style={compactStatusStyle(status)}>{status}</div>
      </div>
    )
    : (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, width: "100%" }}>
        <div style={headerTitleStyle}>
          {session.header}
        </div>
        <div style={headerStatusStyle(status)}>
          {status}
        </div>
        <div style={headerSubtitleStyle}>
          {session.subtitle}
        </div>
      </div>
    )

const TerminalActionButton = (
  {
    children,
    compactTypingMode,
    onClick,
    pressed,
    title
  }: {
    readonly children: string
    readonly compactTypingMode: boolean
    readonly onClick: () => void
    readonly pressed?: boolean
    readonly title?: string
  }
): JSX.Element => (
  <button
    aria-pressed={pressed}
    onClick={onClick}
    style={compactTypingMode ? compactCloseButtonStyle : closeButtonStyle}
    title={title}
    type="button"
  >
    {children}
  </button>
)

const OptionalTerminalActionButton = (
  {
    compactHeaderMode,
    compactLabel,
    enabled,
    label,
    onClick
  }: {
    readonly compactHeaderMode: boolean
    readonly compactLabel: string
    readonly enabled: boolean
    readonly label: string
    readonly onClick: (() => void) | undefined
  }
): JSX.Element | null => {
  if (!enabled || onClick === undefined) {
    return null
  }
  return (
    <TerminalActionButton compactTypingMode={compactHeaderMode} onClick={onClick}>
      {compactHeaderMode ? compactLabel : label}
    </TerminalActionButton>
  )
}

const TerminalHeaderActions = (
  {
    compactHeaderMode,
    inlineImagePreviewsEnabled,
    onApplyProject,
    onDetach,
    onKill,
    onOpenBrowser,
    onOpenSkiller,
    onOpenTaskManager,
    onOpenTerminal,
    onToggleInlineImagePreviews,
    session
  }:
    & Pick<
      TerminalPanelProps,
      | "onApplyProject"
      | "onDetach"
      | "onKill"
      | "onOpenBrowser"
      | "onOpenSkiller"
      | "onOpenTaskManager"
      | "onOpenTerminal"
      | "session"
    >
    & {
      readonly compactHeaderMode: boolean
      readonly inlineImagePreviewsEnabled: boolean
      readonly onToggleInlineImagePreviews: () => void
    }
): JSX.Element => {
  const hasProjectActions = session.browserProjectId !== undefined
  const imageToggleLabel = inlineImagePreviewsEnabled ? "Images on" : "Images off"
  const compactImageToggleLabel = inlineImagePreviewsEnabled ? "Img on" : "Img off"
  const imageToggleTitle = inlineImagePreviewsEnabled
    ? "Automatic image previews enabled"
    : "Automatic image previews disabled"

  return (
    <div style={compactHeaderMode ? compactHeaderActionsStyle : headerActionsStyle}>
      <OptionalTerminalActionButton
        compactHeaderMode={compactHeaderMode}
        compactLabel="Browser"
        enabled={hasProjectActions}
        label="Open browser"
        onClick={onOpenBrowser}
      />
      <OptionalTerminalActionButton
        compactHeaderMode={compactHeaderMode}
        compactLabel="Skiller"
        enabled={hasProjectActions}
        label="Skiller"
        onClick={onOpenSkiller}
      />
      <OptionalTerminalActionButton
        compactHeaderMode={compactHeaderMode}
        compactLabel="Apply"
        enabled={hasProjectActions}
        label="Apply"
        onClick={onApplyProject}
      />
      <OptionalTerminalActionButton
        compactHeaderMode={compactHeaderMode}
        compactLabel="Tasks"
        enabled={hasProjectActions}
        label="Task manager"
        onClick={onOpenTaskManager}
      />
      <OptionalTerminalActionButton
        compactHeaderMode={compactHeaderMode}
        compactLabel="New"
        enabled={hasProjectActions}
        label="New terminal"
        onClick={onOpenTerminal}
      />
      <TerminalActionButton
        compactTypingMode={compactHeaderMode}
        onClick={onToggleInlineImagePreviews}
        pressed={inlineImagePreviewsEnabled}
        title={imageToggleTitle}
      >
        {compactHeaderMode ? compactImageToggleLabel : imageToggleLabel}
      </TerminalActionButton>
      <TerminalActionButton compactTypingMode={compactHeaderMode} onClick={onDetach}>
        Detach
      </TerminalActionButton>
      <TerminalActionButton compactTypingMode={compactHeaderMode} onClick={onKill}>
        Kill
      </TerminalActionButton>
    </div>
  )
}

const TerminalHeader = (
  {
    compactHeaderMode,
    inlineImagePreviewsEnabled,
    onApplyProject,
    onDetach,
    onKill,
    onOpenBrowser,
    onOpenSkiller,
    onOpenTaskManager,
    onOpenTerminal,
    onToggleInlineImagePreviews,
    session,
    status
  }:
    & Pick<
      TerminalPanelProps,
      | "onApplyProject"
      | "onDetach"
      | "onKill"
      | "onOpenBrowser"
      | "onOpenSkiller"
      | "onOpenTaskManager"
      | "onOpenTerminal"
      | "session"
    >
    & {
      readonly compactHeaderMode: boolean
      readonly inlineImagePreviewsEnabled: boolean
      readonly onToggleInlineImagePreviews: () => void
      readonly status: TerminalStatus
    }
): JSX.Element => (
  <div style={compactHeaderMode ? compactHeaderStyle : headerStyle}>
    <TerminalHeaderTitle compactHeaderMode={compactHeaderMode} session={session} status={status} />
    <TerminalHeaderActions
      compactHeaderMode={compactHeaderMode}
      inlineImagePreviewsEnabled={inlineImagePreviewsEnabled}
      onApplyProject={onApplyProject}
      onDetach={onDetach}
      onKill={onKill}
      onOpenBrowser={onOpenBrowser}
      onOpenSkiller={onOpenSkiller}
      onOpenTaskManager={onOpenTaskManager}
      onOpenTerminal={onOpenTerminal}
      onToggleInlineImagePreviews={onToggleInlineImagePreviews}
      session={session}
    />
  </div>
)

const retainTerminalFocus = (controller: TerminalInputController | null): void => {
  controller?.focus()
}

const sendTerminalMobileInput = (
  controller: TerminalInputController | null,
  key: MobileTerminalKey
): void => {
  controller?.sendInput(mobileTerminalKeyInput(key))
  retainTerminalFocus(controller)
}

const shouldKeepMobileCtrlArmed = (event: KeyboardEvent): boolean =>
  event.metaKey || event.altKey || event.ctrlKey || event.isComposing || isModifierOnlyTerminalKey(event.key)

const sendMobileCtrlEventInput = (
  controller: TerminalInputController | null,
  event: KeyboardEvent
): void => {
  const controlCharacter = terminalControlCharacterForKey(event.key)
  if (controlCharacter === null) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  controller?.sendInput(controlCharacter)
  retainTerminalFocus(controller)
}

const MobileTerminalControlButton = (
  {
    active = false,
    label,
    onClick
  }: {
    readonly active?: boolean
    readonly label: string
    readonly onClick: () => void
  }
): JSX.Element => (
  <button
    onClick={onClick}
    onPointerDown={(event) => {
      event.preventDefault()
    }}
    style={mobileControlButtonStyle(active)}
    type="button"
  >
    {label}
  </button>
)

const MobileTerminalControls = (
  {
    collapsed,
    compactTypingMode,
    ctrlArmed,
    onKeyPress,
    onToggleCollapsed,
    onToggleCtrl
  }: {
    readonly collapsed: boolean
    readonly compactTypingMode: boolean
    readonly ctrlArmed: boolean
    readonly onKeyPress: (key: MobileTerminalKey) => void
    readonly onToggleCollapsed: () => void
    readonly onToggleCtrl: () => void
  }
): JSX.Element => (
  collapsed
    ? (
      <div
        style={compactTypingMode ? { ...mobileControlsCollapsedStyle, padding: "6px" } : mobileControlsCollapsedStyle}
      >
        <MobileTerminalControlButton label="Show keys" onClick={onToggleCollapsed} />
      </div>
    )
    : (
      <div style={compactTypingMode ? { ...mobileControlsStyle, gap: "6px", padding: "6px" } : mobileControlsStyle}>
        <div style={mobileControlsRowStyle}>
          <MobileTerminalControlButton
            label="Esc"
            onClick={() => {
              onKeyPress("escape")
            }}
          />
          <MobileTerminalControlButton
            label="Tab"
            onClick={() => {
              onKeyPress("tab")
            }}
          />
          <MobileTerminalControlButton active={ctrlArmed} label="Ctrl" onClick={onToggleCtrl} />
          <MobileTerminalControlButton
            label="Ctrl+C"
            onClick={() => {
              onKeyPress("ctrl-c")
            }}
          />
          <MobileTerminalControlButton label="Hide" onClick={onToggleCollapsed} />
        </div>
        <div style={mobileArrowRowStyle}>
          <MobileTerminalControlButton
            label="←"
            onClick={() => {
              onKeyPress("left")
            }}
          />
          <MobileTerminalControlButton
            label="↑"
            onClick={() => {
              onKeyPress("up")
            }}
          />
          <MobileTerminalControlButton
            label="↓"
            onClick={() => {
              onKeyPress("down")
            }}
          />
          <MobileTerminalControlButton
            label="→"
            onClick={() => {
              onKeyPress("right")
            }}
          />
        </div>
      </div>
    )
)

export const TerminalPanel = (
  {
    bodyContent,
    keyboardOpen,
    mobileMode,
    onApplyProject,
    onAttachFailure,
    onDetach,
    onExit,
    onKill,
    onMessage,
    onOpenBrowser,
    onOpenSkiller,
    onOpenTaskManager,
    onOpenTerminal,
    session
  }: TerminalPanelProps
): JSX.Element => {
  const connectionRef = useRef<TerminalConnectionState>({ closing: false, opened: false })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const inlineImagePreviewsEnabledRef = useRef(true)
  const runtimeRef = useRef<TerminalInputController | null>(null)
  const [status, setStatus] = useState<TerminalStatus>(() => resolveInitialTerminalStatus(session))
  const [inlineImagePreviewsEnabled, setInlineImagePreviewsEnabled] = useState(true)
  const [mobileControlsCollapsed, setMobileControlsCollapsed] = useState(false)
  const [mobileCtrlArmed, setMobileCtrlArmed] = useState(false)
  const terminalSessionId = session.session.id
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
  useEffect(() => {
    setStatus(resolveInitialTerminalStatus(session))
  }, [session])
  useEffect(() => {
    inlineImagePreviewsEnabledRef.current = true
    setInlineImagePreviewsEnabled(true)
  }, [terminalSessionId])
  const notifyAttachFailure = useCallback(() => {
    onAttachFailureRef.current()
  }, [])
  const notifyExit = useCallback((info: TerminalExitInfo) => {
    onExitRef.current?.(info)
  }, [])
  const notifyMessage = useCallback((message: string) => {
    onMessageRef.current(message)
  }, [])
  const toggleInlineImagePreviews = useCallback(() => {
    setInlineImagePreviewsEnabled((current) => {
      const next = !current
      inlineImagePreviewsEnabledRef.current = next
      return next
    })
    retainTerminalFocus(runtimeRef.current)
  }, [])
  const compactHeaderMode = resolveTerminalCompactHeaderMode(mobileMode)
  const compactTypingMode = resolveTerminalTypingMode(mobileMode, keyboardOpen)
  const hasBodyContent = bodyContent !== undefined

  useEffect(() => {
    if (!mobileMode) {
      setMobileControlsCollapsed(false)
      setMobileCtrlArmed(false)
    }
  }, [mobileMode])

  useEffect(() => {
    if (!mobileMode || !mobileCtrlArmed) {
      return
    }
    const host = hostRef.current
    if (host === null) {
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

    host.addEventListener("keydown", handleKeyDown, true)
    return () => {
      host.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [mobileCtrlArmed, mobileMode])

  const handleMobileKeyPress = useCallback((key: MobileTerminalKey) => {
    if (key === "ctrl-c") {
      setMobileCtrlArmed(false)
    }
    sendTerminalMobileInput(runtimeRef.current, key)
  }, [])

  useTerminalSessionLifecycle({
    connectionRef,
    hostRef,
    inlineImagePreviewsEnabledRef,
    notifyExit,
    notifyMessage,
    onAttachFailure: notifyAttachFailure,
    runtimeRef,
    session,
    setStatus
  })

  return (
    <div style={terminalPanelStyle(mobileMode, keyboardOpen)}>
      <TerminalHeader
        compactHeaderMode={compactHeaderMode}
        inlineImagePreviewsEnabled={inlineImagePreviewsEnabled}
        onApplyProject={onApplyProject}
        onDetach={() => {
          connectionRef.current.closing = true
          onDetach()
        }}
        onKill={() => {
          connectionRef.current.closing = true
          onKill()
        }}
        onOpenBrowser={onOpenBrowser}
        onOpenSkiller={onOpenSkiller}
        onOpenTaskManager={onOpenTaskManager}
        onOpenTerminal={onOpenTerminal}
        onToggleInlineImagePreviews={toggleInlineImagePreviews}
        session={session}
        status={status}
      />
      <div style={terminalBodyFrameStyle(compactTypingMode, mobileMode)}>
        <div ref={hostRef} style={terminalHostStyle} />
        {hasBodyContent ? <div style={terminalBodyContentStyle}>{bodyContent}</div> : null}
      </div>
      {mobileMode && !hasBodyContent
        ? (
          <MobileTerminalControls
            collapsed={mobileControlsCollapsed}
            compactTypingMode={compactTypingMode}
            ctrlArmed={mobileCtrlArmed}
            onKeyPress={handleMobileKeyPress}
            onToggleCollapsed={() => {
              setMobileControlsCollapsed((current) => !current)
              setMobileCtrlArmed(false)
              retainTerminalFocus(runtimeRef.current)
            }}
            onToggleCtrl={() => {
              setMobileCtrlArmed((current) => !current)
              retainTerminalFocus(runtimeRef.current)
            }}
          />
        )
        : null}
    </div>
  )
}
