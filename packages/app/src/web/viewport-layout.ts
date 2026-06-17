export type ViewportLayoutMode = "desktop" | "tablet" | "mobile"

export type ViewportSize = {
  readonly height: number
  readonly layoutHeight?: number
  readonly layoutWidth?: number
  readonly offsetLeft?: number
  readonly offsetTop?: number
  readonly width: number
}

export type ViewportLayout = {
  readonly compact: boolean
  readonly dense: boolean
  readonly fontSize: number
  readonly keyboardOpen: boolean
  readonly mode: ViewportLayoutMode
  readonly viewportHeight: number
  readonly viewportOffsetLeft: number
  readonly viewportOffsetTop: number
  readonly viewportWidth: number
}

export const stableWebFontSize = 13

const mobileMaxWidth = 639
const tabletMaxWidth = 1099
const denseMaxHeight = 719
const keyboardViewportLossThresholdPx = 120
const keyboardVisibleRatioThreshold = 0.82

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
  const layoutHeight = size.layoutHeight ?? size.height
  const visibleRatio = layoutHeight <= 0 ? 1 : size.height / layoutHeight
  const isKeyboardOpen = mode === "mobile" &&
    layoutHeight - size.height >= keyboardViewportLossThresholdPx &&
    visibleRatio <= keyboardVisibleRatioThreshold

  return {
    compact: mode !== "desktop",
    dense: size.height <= denseMaxHeight,
    fontSize: stableWebFontSize,
    keyboardOpen: isKeyboardOpen,
    mode,
    viewportHeight: size.height,
    viewportOffsetLeft: size.offsetLeft ?? 0,
    viewportOffsetTop: size.offsetTop ?? 0,
    viewportWidth: size.width
  }
}
