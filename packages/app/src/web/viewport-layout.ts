export type ViewportLayoutMode = "desktop" | "tablet" | "mobile"

export type ViewportSize = {
  readonly height: number
  readonly width: number
}

export type ViewportLayout = {
  readonly compact: boolean
  readonly dense: boolean
  readonly fontSize: number
  readonly mode: ViewportLayoutMode
}

export const stableWebFontSize = 13

const mobileMaxWidth = 639
const tabletMaxWidth = 1099
const denseMaxHeight = 719

export const resolveViewportLayoutMode = ({ width }: Pick<ViewportSize, "width">): ViewportLayoutMode => {
  if (width <= mobileMaxWidth) {
    return "mobile"
  }
  if (width <= tabletMaxWidth) {
    return "tablet"
  }
  return "desktop"
}

export const resolveViewportLayout = (size: ViewportSize): ViewportLayout => {
  const mode = resolveViewportLayoutMode(size)
  return {
    compact: mode !== "desktop",
    dense: size.height <= denseMaxHeight,
    fontSize: stableWebFontSize,
    mode
  }
}
