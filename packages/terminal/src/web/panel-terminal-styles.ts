import type { CSSProperties } from "react"

import type { TerminalStatus } from "./terminal-panel-runtime.js"

const panelStyle: CSSProperties = {
  border: "1px solid #3a4652",
  borderRadius: "8px",
  display: "flex",
  flex: 1,
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden"
}

export const terminalPanelStyle = (isMobileMode: boolean, isKeyboardOpen: boolean): CSSProperties => ({
  ...panelStyle,
  marginTop: isMobileMode || isKeyboardOpen ? 0 : "8px"
})

export const headerStyle: CSSProperties = {
  alignItems: "stretch",
  background: "#101419",
  borderBottom: "1px solid #3a4652",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  justifyContent: "flex-start",
  padding: "10px 12px"
}

export const compactHeaderStyle: CSSProperties = {
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

const terminalBodyStyle = (isCompactTypingMode: boolean, isMobileMode: boolean): CSSProperties => {
  if (isCompactTypingMode) {
    return bodyStyleKeyboardOpen
  }
  return isMobileMode ? bodyStyleMobile : bodyStyle
}

export const terminalBodyFrameStyle = (isCompactTypingMode: boolean, isMobileMode: boolean): CSSProperties => ({
  ...terminalBodyStyle(isCompactTypingMode, isMobileMode),
  boxSizing: "border-box",
  overflow: "hidden",
  position: "relative"
})

export const terminalHostStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  overflow: "hidden"
}

export const terminalBodyContentStyle: CSSProperties = {
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

export const closeButtonStyle: CSSProperties = {
  background: "#171d24",
  border: "1px solid #3a4652",
  borderRadius: "8px",
  color: "#d6e5f7",
  cursor: "pointer",
  font: "inherit",
  padding: "6px 10px"
}

export const compactCloseButtonStyle: CSSProperties = {
  ...closeButtonStyle,
  fontSize: "11px",
  padding: "4px 6px"
}

export const headerActionsStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexShrink: 0,
  flexWrap: "wrap",
  gap: "8px",
  justifyContent: "flex-start",
  width: "100%"
}

export const compactHeaderActionsStyle: CSSProperties = {
  ...headerActionsStyle,
  flexWrap: "wrap",
  gap: "4px",
  justifyContent: "flex-end",
  marginLeft: "auto",
  width: "auto"
}

export const mobileControlsCollapsedStyle: CSSProperties = {
  alignItems: "center",
  background: "#0d1218",
  borderTop: "1px solid #3a4652",
  display: "flex",
  flexShrink: 0,
  justifyContent: "flex-end",
  padding: "8px"
}

export const mobileControlsStyle: CSSProperties = {
  background: "#0d1218",
  borderTop: "1px solid #3a4652",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  gap: "8px",
  padding: "8px"
}

export const mobileControlsRowStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))"
}

export const mobileArrowRowStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))"
}

export const mobileControlButtonStyle = (isActive = false): CSSProperties => ({
  background: isActive ? "#1d3550" : "#121a23",
  border: `1px solid ${isActive ? "#78f0a3" : "#3a4652"}`,
  borderRadius: "8px",
  color: isActive ? "#e8fff0" : "#d6e5f7",
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

export const compactHeaderTitleStyle: CSSProperties = {
  color: "#f6fbff",
  flex: 1,
  fontWeight: 700,
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

export const compactStatusStyle = (status: TerminalStatus): CSSProperties => ({
  color: statusColor(status),
  flexShrink: 0,
  fontSize: "11px",
  whiteSpace: "nowrap"
})

export const headerTitleStyle: CSSProperties = {
  color: "#f6fbff",
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

export const headerStatusStyle = (status: TerminalStatus): CSSProperties => ({
  color: statusColor(status),
  whiteSpace: "nowrap"
})

export const headerSubtitleStyle: CSSProperties = {
  color: "#8fa6c4",
  fontSize: "12px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}
