import { Box, Text } from "ink"
import React from "react"

import { renderLayout } from "./menu-render-layout.js"

export const renderSelectableMenuList = (
  labels: ReadonlyArray<string>,
  selected: number
): ReadonlyArray<React.ReactElement> => {
  const el = React.createElement
  return labels.map((label, index) =>
    el(
      Text,
      { key: `${index}-${label}`, color: index === selected ? "green" : "white" },
      `${index === selected ? ">" : " "} ${index + 1}) ${label}`
    )
  )
}

export const renderMenuHelp = (primaryLine: string): React.ReactElement => {
  const el = React.createElement
  return el(
    Box,
    { marginTop: 1, flexDirection: "column" },
    el(Text, { color: "gray" }, primaryLine),
    el(Text, { color: "gray" }, "Esc returns to the main menu.")
  )
}

type PromptStepLike = {
  readonly label: string
  readonly secret: boolean
}

export const resolvePromptState = (
  steps: ReadonlyArray<PromptStepLike>,
  step: number,
  buffer: string
): { readonly prompt: string; readonly visibleBuffer: string } => {
  const current = steps[step]
  const prompt = current?.label ?? "Value"
  const isSecret = current?.secret === true
  const visibleBuffer = isSecret ? "*".repeat(buffer.length) : buffer
  return { prompt, visibleBuffer }
}

type RenderPromptArgs = {
  readonly title: string
  readonly header: ReadonlyArray<React.ReactElement>
  readonly prompt: string
  readonly visibleBuffer: string
  readonly helpLine: string
  readonly message: string | null
}

export const renderPromptLayout = (args: RenderPromptArgs): React.ReactElement => {
  const el = React.createElement
  return renderLayout(
    args.title,
    [
      ...args.header,
      el(Box, { marginTop: 1 }, el(Text, null, `${args.prompt}: `), el(Text, { color: "green" }, args.visibleBuffer)),
      el(Box, { marginTop: 1, flexDirection: "column" }, el(Text, { color: "gray" }, args.helpLine))
    ],
    args.message
  )
}
