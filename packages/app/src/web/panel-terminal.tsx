import "xterm/css/xterm.css"

import { type CSSProperties, type JSX, useCallback, useEffect, useRef, useState } from "react"

import {
  type TerminalConnectionState,
  type TerminalStatus,
  useTerminalSessionLifecycle
} from "./terminal-panel-runtime.js"
import type { ActiveTerminalSession } from "./terminal.js"

type TerminalPanelProps = {
  readonly onAttachFailure: () => void
  readonly onClose: () => void
  readonly onMessage: (message: string) => void
  readonly onOpenBrowser?: (() => void) | undefined
  readonly onOpenTerminal?: (() => void) | undefined
  readonly session: ActiveTerminalSession
}

const panelStyle: CSSProperties = {
  border: "1px solid #3a4652",
  borderRadius: "8px",
  display: "flex",
  flex: 1,
  flexDirection: "column",
  marginTop: "8px",
  minHeight: 0,
  overflow: "hidden"
}

const headerStyle: CSSProperties = {
  alignItems: "center",
  background: "#101419",
  borderBottom: "1px solid #3a4652",
  display: "flex",
  gap: "12px",
  justifyContent: "space-between",
  padding: "10px 12px"
}

const bodyStyle: CSSProperties = {
  background: "#080a0d",
  flex: 1,
  minHeight: 0,
  padding: "8px"
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

const headerActionsStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexShrink: 0,
  flexWrap: "wrap",
  gap: "8px",
  justifyContent: "flex-end"
}

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

const TerminalHeaderTitle = (
  { session, status }: Pick<TerminalPanelProps, "session"> & { readonly status: TerminalStatus }
): JSX.Element => (
  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
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
  { children, onClick }: { readonly children: string; readonly onClick: () => void }
): JSX.Element => (
  <button
    onClick={onClick}
    style={closeButtonStyle}
    type="button"
  >
    {children}
  </button>
)

const TerminalHeaderActions = (
  {
    onClose,
    onOpenBrowser,
    onOpenTerminal,
    session
  }: Pick<TerminalPanelProps, "onClose" | "onOpenBrowser" | "onOpenTerminal" | "session">
): JSX.Element => (
  <div style={headerActionsStyle}>
    {session.browserProjectId === undefined || onOpenBrowser === undefined
      ? null
      : <TerminalActionButton onClick={onOpenBrowser}>Open browser</TerminalActionButton>}
    {session.browserProjectId === undefined || onOpenTerminal === undefined
      ? null
      : <TerminalActionButton onClick={onOpenTerminal}>New terminal</TerminalActionButton>}
    <TerminalActionButton onClick={onClose}>Close terminal</TerminalActionButton>
  </div>
)

const TerminalHeader = (
  {
    onClose,
    onOpenBrowser,
    onOpenTerminal,
    session,
    status
  }: Pick<TerminalPanelProps, "onClose" | "onOpenBrowser" | "onOpenTerminal" | "session"> & {
    readonly status: TerminalStatus
  }
): JSX.Element => (
  <div style={headerStyle}>
    <TerminalHeaderTitle session={session} status={status} />
    <TerminalHeaderActions
      onClose={onClose}
      onOpenBrowser={onOpenBrowser}
      onOpenTerminal={onOpenTerminal}
      session={session}
    />
  </div>
)

export const TerminalPanel = (
  { onAttachFailure, onClose, onMessage, onOpenBrowser, onOpenTerminal, session }: TerminalPanelProps
): JSX.Element => {
  const connectionRef = useRef<TerminalConnectionState>({ closing: false, opened: false })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<TerminalStatus>("connecting")
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

  useTerminalSessionLifecycle({
    connectionRef,
    hostRef,
    notifyMessage,
    onAttachFailure: notifyAttachFailure,
    session,
    setStatus
  })

  return (
    <div style={panelStyle}>
      <TerminalHeader
        onClose={() => {
          connectionRef.current.closing = true
          onClose()
        }}
        onOpenBrowser={onOpenBrowser}
        onOpenTerminal={onOpenTerminal}
        session={session}
        status={status}
      />
      <div ref={hostRef} style={bodyStyle} />
    </div>
  )
}
