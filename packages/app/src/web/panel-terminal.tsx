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
  type TerminalInputController,
  type TerminalStatus,
  useTerminalSessionLifecycle
} from "./terminal-panel-runtime.js"
import type { ActiveTerminalSession } from "./terminal.js"

type TerminalPanelProps = {
  readonly keyboardOpen: boolean
  readonly mobileMode: boolean
  readonly onAttachFailure: () => void
  readonly onDetach: () => void
  readonly onKill: () => void
  readonly onMessage: (message: string) => void
  readonly onOpenBrowser?: (() => void) | undefined
  readonly onOpenTaskManager?: (() => void) | undefined
  readonly onOpenTerminal?: (() => void) | undefined
  readonly session: ActiveTerminalSession
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
  alignItems: "center",
  background: "#101419",
  borderBottom: "1px solid #3a4652",
  display: "flex",
  gap: "12px",
  justifyContent: "flex-start",
  padding: "10px 12px"
}

const compactHeaderStyle: CSSProperties = {
  ...headerStyle,
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
  justifyContent: "flex-end",
  marginLeft: "auto"
}

const compactHeaderActionsStyle: CSSProperties = {
  ...headerActionsStyle,
  flexWrap: "wrap",
  gap: "4px"
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
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
        <div style={{ color: "#f6fbff", fontWeight: 700 }}>
          {session.header}
        </div>
        <div style={{ color: statusColor(status) }}>
          {status}
        </div>
        <div style={{ color: "#8fa6c4", fontSize: "12px" }}>
          {session.subtitle}
        </div>
      </div>
    )

const TerminalActionButton = (
  {
    children,
    compactTypingMode,
    onClick
  }: {
    readonly children: string
    readonly compactTypingMode: boolean
    readonly onClick: () => void
  }
): JSX.Element => (
  <button
    onClick={onClick}
    style={compactTypingMode ? compactCloseButtonStyle : closeButtonStyle}
    type="button"
  >
    {children}
  </button>
)

const TerminalHeaderActions = (
  {
    compactHeaderMode,
    onDetach,
    onKill,
    onOpenBrowser,
    onOpenTaskManager,
    onOpenTerminal,
    session
  }: Pick<
    TerminalPanelProps,
    "onDetach" | "onKill" | "onOpenBrowser" | "onOpenTaskManager" | "onOpenTerminal" | "session"
  > & {
    readonly compactHeaderMode: boolean
  }
): JSX.Element => (
  <div style={compactHeaderMode ? compactHeaderActionsStyle : headerActionsStyle}>
    {session.browserProjectId === undefined || onOpenBrowser === undefined
      ? null
      : (
        <TerminalActionButton compactTypingMode={compactHeaderMode} onClick={onOpenBrowser}>
          {compactHeaderMode ? "Browser" : "Open browser"}
        </TerminalActionButton>
      )}
    {session.browserProjectId === undefined || onOpenTaskManager === undefined
      ? null
      : (
        <TerminalActionButton compactTypingMode={compactHeaderMode} onClick={onOpenTaskManager}>
          {compactHeaderMode ? "Tasks" : "Task manager"}
        </TerminalActionButton>
      )}
    {session.browserProjectId === undefined || onOpenTerminal === undefined
      ? null
      : (
        <TerminalActionButton compactTypingMode={compactHeaderMode} onClick={onOpenTerminal}>
          {compactHeaderMode ? "New" : "New terminal"}
        </TerminalActionButton>
      )}
    <TerminalActionButton compactTypingMode={compactHeaderMode} onClick={onDetach}>
      Detach
    </TerminalActionButton>
    <TerminalActionButton compactTypingMode={compactHeaderMode} onClick={onKill}>
      Kill
    </TerminalActionButton>
  </div>
)

const TerminalHeader = (
  {
    compactHeaderMode,
    onDetach,
    onKill,
    onOpenBrowser,
    onOpenTaskManager,
    onOpenTerminal,
    session,
    status
  }: Pick<
    TerminalPanelProps,
    "onDetach" | "onKill" | "onOpenBrowser" | "onOpenTaskManager" | "onOpenTerminal" | "session"
  > & {
    readonly compactHeaderMode: boolean
    readonly status: TerminalStatus
  }
): JSX.Element => (
  <div style={compactHeaderMode ? compactHeaderStyle : headerStyle}>
    <TerminalHeaderTitle compactHeaderMode={compactHeaderMode} session={session} status={status} />
    <TerminalHeaderActions
      compactHeaderMode={compactHeaderMode}
      onDetach={onDetach}
      onKill={onKill}
      onOpenBrowser={onOpenBrowser}
      onOpenTaskManager={onOpenTaskManager}
      onOpenTerminal={onOpenTerminal}
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
    keyboardOpen,
    mobileMode,
    onAttachFailure,
    onDetach,
    onKill,
    onMessage,
    onOpenBrowser,
    onOpenTaskManager,
    onOpenTerminal,
    session
  }: TerminalPanelProps
): JSX.Element => {
  const connectionRef = useRef<TerminalConnectionState>({ closing: false, opened: false })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<TerminalInputController | null>(null)
  const [status, setStatus] = useState<TerminalStatus>("connecting")
  const [mobileControlsCollapsed, setMobileControlsCollapsed] = useState(false)
  const [mobileCtrlArmed, setMobileCtrlArmed] = useState(false)
  const onAttachFailureRef = useRef(onAttachFailure)
  const onMessageRef = useRef(onMessage)
  useEffect(() => {
    onAttachFailureRef.current = onAttachFailure
  }, [onAttachFailure])
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])
  const notifyAttachFailure = useCallback(() => {
    onAttachFailureRef.current()
  }, [])
  const notifyMessage = useCallback((message: string) => {
    onMessageRef.current(message)
  }, [])
  const compactHeaderMode = resolveTerminalCompactHeaderMode(mobileMode)
  const compactTypingMode = resolveTerminalTypingMode(mobileMode, keyboardOpen)

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
        onDetach={() => {
          connectionRef.current.closing = true
          onDetach()
        }}
        onKill={() => {
          connectionRef.current.closing = true
          onKill()
        }}
        onOpenBrowser={onOpenBrowser}
        onOpenTaskManager={onOpenTaskManager}
        onOpenTerminal={onOpenTerminal}
        session={session}
        status={status}
      />
      <div
        ref={hostRef}
        style={terminalBodyStyle(compactTypingMode, mobileMode)}
      />
      {mobileMode
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
