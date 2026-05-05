import { describe, expect, it } from "vitest"

import { resolveViewportLayout, stableWebFontSize } from "../../src/web/viewport-layout.js"

describe("viewport layout", () => {
  it("keeps desktop as a non-compact single-page layout", () => {
    expect(resolveViewportLayout({ height: 900, width: 1440 })).toEqual({
      compact: false,
      dense: false,
      fontSize: stableWebFontSize,
      keyboardOpen: false,
      mode: "desktop",
      viewportHeight: 900,
      viewportOffsetLeft: 0,
      viewportOffsetTop: 0,
      viewportWidth: 1440
    })
  })

  it("uses compact tablet layout without changing font size", () => {
    expect(resolveViewportLayout({ height: 768, width: 1024 })).toEqual({
      compact: true,
      dense: false,
      fontSize: stableWebFontSize,
      keyboardOpen: false,
      mode: "tablet",
      viewportHeight: 768,
      viewportOffsetLeft: 0,
      viewportOffsetTop: 0,
      viewportWidth: 1024
    })
  })

  it("uses compact dense mobile layout", () => {
    expect(resolveViewportLayout({ height: 640, width: 390 })).toEqual({
      compact: true,
      dense: true,
      fontSize: stableWebFontSize,
      keyboardOpen: false,
      mode: "mobile",
      viewportHeight: 640,
      viewportOffsetLeft: 0,
      viewportOffsetTop: 0,
      viewportWidth: 390
    })
  })

  it("detects an open mobile keyboard from visual viewport shrink", () => {
    expect(resolveViewportLayout({
      height: 360,
      layoutHeight: 844,
      offsetLeft: 0,
      offsetTop: 18,
      width: 390
    })).toEqual({
      compact: true,
      dense: true,
      fontSize: stableWebFontSize,
      keyboardOpen: true,
      mode: "mobile",
      viewportHeight: 360,
      viewportOffsetLeft: 0,
      viewportOffsetTop: 18,
      viewportWidth: 390
    })
  })
})
