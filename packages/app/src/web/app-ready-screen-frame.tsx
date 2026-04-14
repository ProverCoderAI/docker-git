import type { JSX } from "react"

import { Box, Text } from "./elements.js"

type ScreenFrameProps = {
  readonly children: JSX.Element
  readonly hint: string
  readonly onBack?: (() => void) | undefined
  readonly title: string
}

export const screenPadding = (compact: boolean): number | string => compact ? "8px" : 2

const ScreenHeader = ({ hint, onBack, title }: Omit<ScreenFrameProps, "children">): JSX.Element => (
  <Box
    alignItems="center"
    border={true}
    borderColor="#3a4652"
    flexShrink={0}
    flexWrap="wrap"
    gap={1}
    justifyContent="space-between"
    padding={1}
  >
    <Box flexDirection="column" minWidth={0}>
      <Text bold={true} fg="#f4f7fb" wrap="truncate">{title}</Text>
      <Text fg="#aab7c4" wrap="truncate">{hint}</Text>
    </Box>
    {onBack === undefined
      ? null
      : (
        <Box onClick={onBack} width="auto">
          <Text fg="#78f0a3">Back</Text>
        </Box>
      )}
  </Box>
)

export const ScreenFrame = ({ children, hint, onBack, title }: ScreenFrameProps): JSX.Element => (
  <Box flexDirection="column" flexGrow={1} gap={1} minHeight={0} overflow="hidden">
    <ScreenHeader hint={hint} onBack={onBack} title={title} />
    <Box
      border={true}
      borderColor="#3a4652"
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
      overflow="hidden"
      padding={1}
    >
      {children}
    </Box>
  </Box>
)
