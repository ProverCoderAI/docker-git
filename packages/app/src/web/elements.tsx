import { createElement, type CSSProperties, type JSX, type MouseEventHandler, type ReactNode } from "react"

type GridElementProps = {
  readonly alignItems?: CSSProperties["alignItems"]
  readonly backgroundColor?: string
  readonly bold?: boolean
  readonly border?: boolean
  readonly borderColor?: string
  readonly borderStyle?: "rounded" | "single"
  readonly children?: ReactNode
  readonly fg?: string
  readonly flexDirection?: CSSProperties["flexDirection"]
  readonly flexBasis?: CSSProperties["flexBasis"]
  readonly flexGrow?: number
  readonly flexShrink?: number
  readonly flexWrap?: CSSProperties["flexWrap"]
  readonly gap?: number | string
  readonly height?: number | string
  readonly justifyContent?: CSSProperties["justifyContent"]
  readonly marginBottom?: number | string
  readonly marginTop?: number | string
  readonly maxHeight?: number | string
  readonly maxWidth?: number | string
  readonly minHeight?: number | string
  readonly minWidth?: number | string
  readonly onClick?: MouseEventHandler<HTMLElement>
  readonly overflow?: CSSProperties["overflow"]
  readonly overflowX?: CSSProperties["overflowX"]
  readonly overflowY?: CSSProperties["overflowY"]
  readonly padding?: number | string
  readonly width?: number | string
  readonly wrap?: "truncate" | "wrap"
}

const unit = (value: number | string | undefined): string | number | undefined => {
  if (value === undefined) {
    return undefined
  }
  return typeof value === "number" ? `${value * 8}px` : value
}

const borderRadius = (borderStyle: GridElementProps["borderStyle"]): string => borderStyle === "rounded" ? "8px" : "0"

const borderValue = (
  enabled: boolean | undefined,
  borderColor: string | undefined
): string | undefined => enabled ? `1px solid ${borderColor ?? "#3a4652"}` : undefined

const baseStyle = (props: GridElementProps): CSSProperties => ({
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

const interactiveStyle = (
  onClick: MouseEventHandler<HTMLElement> | undefined,
  width: GridElementProps["width"]
): CSSProperties =>
  onClick === undefined
    ? {}
    : {
      background: "transparent",
      cursor: "pointer",
      font: "inherit",
      textAlign: "left",
      width: width === undefined ? "100%" : unit(width)
    }

const textStyle = (props: GridElementProps): CSSProperties => ({
  ...baseStyle(props),
  display: "block",
  fontWeight: props.bold ? 700 : 400,
  lineHeight: 1.45,
  overflow: props.wrap === "truncate" ? "hidden" : props.overflow,
  textOverflow: props.wrap === "truncate" ? "ellipsis" : undefined,
  whiteSpace: props.wrap === "truncate" ? "nowrap" : "pre-wrap",
  width: unit(props.width) ?? "auto"
})

export const Box = ({ children, onClick, ...props }: GridElementProps): JSX.Element =>
  createElement(onClick === undefined ? "div" : "button", {
    children,
    onClick: onClick === undefined
      ? undefined
      : ((event: Parameters<MouseEventHandler<HTMLElement>>[0]) => {
        onClick(event)
        event.currentTarget.blur()
      }) satisfies MouseEventHandler<HTMLElement>,
    style: {
      ...baseStyle(props),
      ...interactiveStyle(onClick, props.width)
    },
    type: onClick === undefined ? undefined : "button"
  })

export const Text = ({ children, ...props }: GridElementProps): JSX.Element =>
  createElement("div", {
    children,
    style: textStyle(props)
  })
