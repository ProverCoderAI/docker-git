import type { JSX, ReactNode } from "react"

import type { ActionPromptState } from "../web/action-prompt.js"
import { Box, Button, Text, TextInput } from "./primitives.js"

export const ScreenLayout = (
  {
    body,
    message,
    title
  }: {
    readonly body: ReadonlyArray<JSX.Element>
    readonly message: string | null | undefined
    readonly title: string
  }
): JSX.Element => (
  <Box border={true} borderColor="#24537d" borderStyle="rounded" flexDirection="column" padding={1}>
    <Text bold={true} fg="#8be9fd">{title}</Text>
    {body}
    {message === undefined || message === null || message.length === 0
      ? null
      : (
        <Box marginTop={1}>
          <Text fg="#f6d27b">{message}</Text>
        </Box>
      )}
  </Box>
)

export const SelectableList = (
  {
    labels,
    selectedIndex
  }: {
    readonly labels: ReadonlyArray<string>
    readonly selectedIndex: number
  }
): ReadonlyArray<JSX.Element> =>
  labels.map((label, index) => (
    <Text key={`${index}-${label}`} bold={index === selectedIndex} fg={index === selectedIndex ? "#56f39a" : "#d6e5f7"}>
      {index === selectedIndex ? "> " : "  "}
      {label}
    </Text>
  ))

export const HelpLines = ({ lines }: { readonly lines: ReadonlyArray<string> }): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    {lines.map((line, index) => <Text key={`${index}-${line}`} fg="#8fa6c4">{line}</Text>)}
  </Box>
)

export const SnapshotLine = (
  { label, value }: { readonly label: string; readonly value: ReactNode }
): JSX.Element => <Text fg="#d6e5f7">{label}: {value}</Text>

export const ActionLine = (
  {
    hint,
    label,
    onClick
  }: {
    readonly hint?: string
    readonly label: string
    readonly onClick?: () => void
  }
): JSX.Element => (
  <Box
    border={true}
    borderColor="#21486d"
    borderStyle="single"
    flexDirection="column"
    marginBottom={1}
    {...(onClick === undefined ? {} : { onClick })}
    padding={1}
  >
    <Text fg="#f6fbff">{label}</Text>
    {hint === undefined ? null : <Text fg="#7fdfff">{hint}</Text>}
  </Box>
)

export const PromptScreen = (
  {
    header,
    helpLines,
    message,
    prompt,
    title,
    value
  }: {
    readonly header: ReadonlyArray<JSX.Element>
    readonly helpLines: ReadonlyArray<string>
    readonly message: string | null | undefined
    readonly prompt: string
    readonly title: string
    readonly value: string
  }
): JSX.Element =>
  ScreenLayout({
    title,
    body: [
      ...header,
      (
        <Box key="prompt-line" marginTop={1}>
          <Text fg="#d6e5f7">{prompt}:</Text>
          <Text fg="#56f39a">{value}</Text>
        </Box>
      ),
      <HelpLines key="prompt-help" lines={helpLines} />
    ],
    message
  })

const ActionPromptField = (
  {
    actionPrompt,
    index,
    onActionPromptCancel,
    onActionPromptChange,
    onActionPromptSubmit
  }: {
    readonly actionPrompt: ActionPromptState
    readonly index: number
    readonly onActionPromptCancel: () => void
    readonly onActionPromptChange: (key: string, value: string) => void
    readonly onActionPromptSubmit: () => void
  }
): JSX.Element => {
  const step = actionPrompt.steps[index]
  if (step === undefined) {
    return <></>
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text fg="#d6e5f7">{step.label}</Text>
      <TextInput
        ariaLabel={step.label}
        autoFocus={index === 0}
        onChange={(value) => {
          onActionPromptChange(step.key, value)
        }}
        onEnter={() => {
          onActionPromptSubmit()
        }}
        onEscape={onActionPromptCancel}
        secret={step.secret}
        value={actionPrompt.values[step.key] ?? ""}
      />
    </Box>
  )
}

export const ActionPromptPanel = (
  {
    actionPrompt,
    onActionPromptCancel,
    onActionPromptChange,
    onActionPromptSubmit
  }: {
    readonly actionPrompt: ActionPromptState
    readonly onActionPromptCancel: () => void
    readonly onActionPromptChange: (key: string, value: string) => void
    readonly onActionPromptSubmit: () => void
  }
): JSX.Element => (
  <Box border={true} borderColor="#24537d" borderStyle="single" flexDirection="column" marginTop={1} padding={1}>
    <Text bold={true} fg="#8be9fd">{actionPrompt.title}</Text>
    <Text fg="#8fa6c4" marginTop={1}>Enter = submit, Esc = cancel.</Text>
    <Box flexDirection="column" marginTop={1}>
      {actionPrompt.steps.map((step, index) => (
        <ActionPromptField
          actionPrompt={actionPrompt}
          index={index}
          key={step.key}
          onActionPromptCancel={onActionPromptCancel}
          onActionPromptChange={onActionPromptChange}
          onActionPromptSubmit={onActionPromptSubmit}
        />
      ))}
    </Box>
    <Box gap={1} marginTop={1}>
      <Button
        label="Run action"
        onPress={() => {
          onActionPromptSubmit()
        }}
      />
      <Button
        label="Cancel"
        onPress={() => {
          onActionPromptCancel()
        }}
      />
    </Box>
  </Box>
)
