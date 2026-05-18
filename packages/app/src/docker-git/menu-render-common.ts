import React from "react"

import { HelpLines, PromptScreen, SelectableList } from "../ui/shared.js"

export const renderSelectableMenuList = (
  labels: ReadonlyArray<string>,
  selected: number
): ReadonlyArray<React.ReactElement> => {
  return SelectableList({
    labels: labels.map((label, index) => `${index + 1}) ${label}`),
    selectedIndex: selected
  })
}

export const renderMenuHelp = (primaryLine: string): React.ReactElement =>
  HelpLines({ lines: [primaryLine, "Esc returns to the main menu."] })

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
  return React.createElement(PromptScreen, {
    header: [...args.header],
    helpLines: [args.helpLine],
    message: args.message,
    prompt: args.prompt,
    title: args.title,
    value: args.visibleBuffer
  })
}
