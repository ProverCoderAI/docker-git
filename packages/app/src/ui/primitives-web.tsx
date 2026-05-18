import { createElement, type CSSProperties, type JSX } from "react"

import type { UiBoxProps, UiButtonProps, UiTextInputProps, UiTextProps } from "./primitives.js"

const unit = (value: number | string | undefined): string | number | undefined => {
  if (value === undefined) {
    return undefined
  }
  return typeof value === "number" ? `${value * 8}px` : value
}

const borderRadius = (borderStyle: UiBoxProps["borderStyle"]): string => borderStyle === "rounded" ? "8px" : "0"

const borderValue = (
  enabled: boolean | undefined,
  borderColor: string | undefined
): string | undefined => enabled ? `1px solid ${borderColor ?? "#24537d"}` : undefined

const baseStyle = (props: UiBoxProps): CSSProperties => ({
  alignItems: props.alignItems,
  backgroundColor: props.backgroundColor,
  border: borderValue(props.border, props.borderColor),
  borderRadius: borderRadius(props.borderStyle),
  boxSizing: "border-box",
  color: props.fg,
  display: "flex",
  flexBasis: props.flexBasis,
  flexDirection: props.flexDirection ?? "row",
  flexGrow: props.flexGrow,
  flexShrink: props.flexShrink,
  flexWrap: props.flexWrap,
  gap: unit(props.gap),
  height: unit(props.height),
  justifyContent: props.justifyContent,
  marginBottom: unit(props.marginBottom),
  marginLeft: unit(props.marginLeft),
  marginRight: unit(props.marginRight),
  marginTop: unit(props.marginTop),
  maxHeight: unit(props.maxHeight),
  maxWidth: unit(props.maxWidth),
  minHeight: unit(props.minHeight),
  minWidth: unit(props.minWidth),
  overflow: props.overflow,
  overflowX: props.overflowX,
  overflowY: props.overflowY,
  padding: unit(props.padding),
  width: unit(props.width)
})

const textStyle = (props: UiTextProps): CSSProperties => ({
  ...baseStyle(props),
  display: "block",
  fontWeight: props.bold ? 700 : 400,
  lineHeight: 1.45,
  overflow: props.wrap === "truncate" ? "hidden" : undefined,
  textOverflow: props.wrap === "truncate" ? "ellipsis" : undefined,
  whiteSpace: props.wrap === "truncate" ? "nowrap" : "pre-wrap",
  width: unit(props.width) ?? "auto"
})

const interactiveStyle = (width: UiBoxProps["width"]): CSSProperties => ({
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  width: width === undefined ? "100%" : unit(width)
})

const inputStyle: CSSProperties = {
  background: "#07101c",
  border: "1px solid #24537d",
  borderRadius: "8px",
  boxSizing: "border-box",
  color: "#56f39a",
  font: "inherit",
  outline: "none",
  padding: "10px 12px",
  width: "100%"
}

const buttonStyle: CSSProperties = {
  background: "#10253c",
  border: "1px solid #24537d",
  borderRadius: "8px",
  color: "#d6e5f7",
  cursor: "pointer",
  font: "inherit",
  padding: "8px 12px"
}

export const webPrimitives = {
  Box: ({ children, onClick, ...props }: UiBoxProps): JSX.Element =>
    createElement(onClick === undefined ? "div" : "button", {
      children,
      onClick,
      style: {
        ...baseStyle(props),
        ...(onClick === undefined ? {} : interactiveStyle(props.width))
      },
      type: onClick === undefined ? undefined : "button"
    }),
  Button: ({ label, onPress }: UiButtonProps): JSX.Element => (
    <button onClick={onPress} style={buttonStyle} type="button">
      {label}
    </button>
  ),
  Text: ({ children, ...props }: UiTextProps): JSX.Element =>
    createElement("div", {
      children,
      style: textStyle(props)
    }),
  TextInput: (props: UiTextInputProps): JSX.Element =>
    props.multiline === true ? <MultilineTextInput {...props} /> : <SingleLineTextInput {...props} />
} as const

const horizontalArrowAction = (
  key: string,
  onArrowLeft: (() => void) | undefined,
  onArrowRight: (() => void) | undefined
): (() => void) | null => {
  if (key === "ArrowLeft") {
    return onArrowLeft ?? null
  }
  if (key === "ArrowRight") {
    return onArrowRight ?? null
  }
  return null
}

const MultilineTextInput = (
  {
    ariaLabel,
    autoFocus,
    minRows,
    onArrowLeft,
    onArrowRight,
    onChange,
    onEnter,
    onEscape,
    placeholder,
    value
  }: UiTextInputProps
): JSX.Element => {
  const rows = minRows ?? 6
  return (
    <textarea
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onChange={(event) => {
        onChange(event.currentTarget.value)
      }}
      onKeyDown={(event) => {
        const onArrow = horizontalArrowAction(event.key, onArrowLeft, onArrowRight)
        if (onArrow !== null) {
          event.preventDefault()
          event.stopPropagation()
          onArrow()
          return
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          event.stopPropagation()
          onEnter?.(event.shiftKey)
          return
        }
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          onEscape?.()
        }
      }}
      placeholder={placeholder}
      rows={rows}
      style={{
        ...inputStyle,
        color: "#d6e5f7",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        minHeight: `${rows * 1.5}em`,
        resize: "vertical"
      }}
      value={value}
    />
  )
}

const SingleLineTextInput = (
  {
    ariaLabel,
    autoFocus,
    onArrowLeft,
    onArrowRight,
    onChange,
    onEnter,
    onEscape,
    placeholder,
    secret,
    value
  }: UiTextInputProps
): JSX.Element => (
  <input
    aria-label={ariaLabel}
    autoFocus={autoFocus}
    onChange={(event) => {
      onChange(event.currentTarget.value)
    }}
    onKeyDown={(event) => {
      const onArrow = horizontalArrowAction(event.key, onArrowLeft, onArrowRight)
      if (onArrow !== null) {
        event.preventDefault()
        event.stopPropagation()
        onArrow()
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        event.stopPropagation()
        onEnter?.(event.shiftKey)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onEscape?.()
      }
    }}
    placeholder={placeholder}
    style={inputStyle}
    type={secret ? "password" : "text"}
    value={value}
  />
)
