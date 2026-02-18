import { Box, Text } from "ink"
import React from "react"

const renderMessage = (message: string | null): React.ReactElement | null => {
  if (!message) {
    return null
  }
  return React.createElement(
    Box,
    { marginTop: 1 },
    React.createElement(Text, { color: "magenta" }, message)
  )
}

export const renderLayout = (
  title: string,
  body: ReadonlyArray<React.ReactElement>,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const messageView = renderMessage(message)
  const tail = messageView ? [messageView] : []
  return el(
    Box,
    { flexDirection: "column", padding: 1, borderStyle: "round" },
    el(Text, { color: "cyan", bold: true }, title),
    ...body,
    ...tail
  )
}
