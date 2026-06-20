import { type CSSProperties } from "react"

export const codeBlockStyle: CSSProperties = {
  background: "#0b1017",
  border: "1px solid #2a3640",
  borderRadius: "2px",
  color: "#a8c8f0",
  display: "block",
  fontFamily: "inherit",
  fontSize: "0.85em",
  marginBottom: "4px",
  marginTop: "4px",
  overflowX: "auto",
  padding: "6px 8px",
  whiteSpace: "pre"
}

export const buttonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#56f39a",
  cursor: "pointer",
  font: "inherit",
  fontWeight: "bold",
  padding: "2px 6px"
}

export const vscodeLinkStyle: CSSProperties = {
  color: "#56f39a",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "inherit",
  fontWeight: "bold",
  padding: "2px 6px",
  textDecoration: "none"
}

export const centeredBoxStyle: CSSProperties = {
  border: "1px solid #3a4652",
  borderRadius: "4px",
  color: "#d6e5f7",
  padding: "16px 24px",
  textAlign: "center"
}

export const copyText = (text: string): void => void navigator.clipboard.writeText(text)
