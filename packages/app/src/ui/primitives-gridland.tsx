import type { JSX } from "react"

import type { GridlandInputProps, GridlandModule } from "@gridland/bun"

import type { UiBoxProps, UiButtonProps, UiTextInputProps, UiTextProps } from "./primitives.js"

const renderInputValue = (props: UiTextInputProps): string => {
  if (props.value.length === 0) {
    return props.placeholder ?? ""
  }
  return props.secret ? "*".repeat(props.value.length) : props.value
}

const inputProps = (props: UiTextInputProps): GridlandInputProps => ({
  ariaLabel: props.ariaLabel,
  autoFocus: props.autoFocus,
  placeholder: props.placeholder,
  value: renderInputValue(props)
})

export const createGridlandPrimitives = (gridland: GridlandModule) => {
  const GridlandBox = gridland.Box
  const GridlandInput = gridland.Input
  const GridlandText = gridland.Text

  return {
    Box: ({ children, ...props }: UiBoxProps): JSX.Element => (
      <GridlandBox
        alignItems={props.alignItems}
        backgroundColor={props.backgroundColor}
        border={props.border}
        borderColor={props.borderColor}
        borderStyle={props.borderStyle}
        color={props.fg}
        flexDirection={props.flexDirection}
        flexGrow={props.flexGrow}
        flexWrap={props.flexWrap}
        gap={props.gap}
        height={props.height}
        justifyContent={props.justifyContent}
        marginBottom={props.marginBottom}
        marginLeft={props.marginLeft}
        marginRight={props.marginRight}
        marginTop={props.marginTop}
        padding={props.padding}
        width={props.width}
      >
        {children}
      </GridlandBox>
    ),
    Button: ({ label }: UiButtonProps): JSX.Element => <GridlandText color="cyan">[{label}]</GridlandText>,
    Text: ({ children, ...props }: UiTextProps): JSX.Element => (
      <GridlandText
        bold={props.bold}
        color={props.fg}
        marginBottom={props.marginBottom}
        marginLeft={props.marginLeft}
        marginRight={props.marginRight}
        marginTop={props.marginTop}
        truncate={props.wrap === "truncate"}
        width={props.width}
      >
        {children}
      </GridlandText>
    ),
    TextInput: (props: UiTextInputProps): JSX.Element => <GridlandInput {...inputProps(props)} />
  } as const
}
