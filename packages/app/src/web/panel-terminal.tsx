import "xterm/css/xterm.css"

import { type CSSProperties, type JSX, useEffectEvent, useRef, useState } from "react"

import {
  type TerminalConnectionState,
  type TerminalStatus,
  useTerminalSessionLifecycle
} from "./terminal-panel-runtime.js"
import type { ActiveTerminalSession } from "./terminal.js"

type TerminalPanelProps = {
  readonly onClose: () => void
  readonly onMessage: (message: string) => void
  readonly session: ActiveTerminalSession
}

const panelStyle: CSSProperties = {
  border: "1px solid #21486d",
  borderRadius: "12px",
  display: "flex",
  flexDirection: "column",
  marginTop: "8px",
  minHeight: "320px",
  overflow: "hidden"
}

const headerStyle: CSSProperties = {
  alignItems: "center",
  background: "#07111f",
  borderBottom: "1px solid #21486d",
  display: "flex",
  gap: "12px",
  justifyContent: "space-between",
  padding: "10px 12px"
}

const bodyStyle: CSSProperties = {
  background: "#050b14",
  flex: 1,
  minHeight: "280px",
  padding: "8px"
}

const closeButtonStyle: CSSProperties = {
  background: "#10253c",
  border: "1px solid #24537d",
  borderRadius: "8px",
  color: "#d6e5f7",
  cursor: "pointer",
  font: "inherit",
  padding: "6px 10px"
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

const TerminalHeader = (
  {
    onClose,
    session,
    status
  }: Pick<TerminalPanelProps, "onClose" | "session"> & { readonly status: TerminalStatus }
): JSX.Element => (
  <div style={headerStyle}>
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
    <button
      onClick={onClose}
      style={closeButtonStyle}
      type="button"
    >
      Close terminal
    </button>
  </div>
)

export const TerminalPanel = (
  { onClose, onMessage, session }: TerminalPanelProps
): JSX.Element => {
  const connectionRef = useRef<TerminalConnectionState>({ opened: false })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<TerminalStatus>("connecting")
  const notifyMessage = useEffectEvent(onMessage)

  useTerminalSessionLifecycle({
    connectionRef,
    hostRef,
    notifyMessage,
    session,
    setStatus
  })

  return (
    <div style={panelStyle}>
      <TerminalHeader onClose={onClose} session={session} status={status} />
      <div ref={hostRef} style={bodyStyle} />
    </div>
  )
}
