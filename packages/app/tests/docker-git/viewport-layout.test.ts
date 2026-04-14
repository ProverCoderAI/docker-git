import { describe, expect, it } from "vitest"

import { resolveViewportLayout, stableWebFontSize } from "../../src/web/viewport-layout.js"

describe("viewport layout", () => {
  it("keeps desktop as a non-compact single-page layout", () => {
    expect(resolveViewportLayout({ height: 900, width: 1440 })).toEqual({
      compact: false,
      dense: false,
      fontSize: stableWebFontSize,
      mode: "desktop"
    })
  })

  it("uses compact tablet layout without changing font size", () => {
    expect(resolveViewportLayout({ height: 768, width: 1024 })).toEqual({
      compact: true,
      dense: false,
      fontSize: stableWebFontSize,
      mode: "tablet"
    })
  })

  it("uses compact dense mobile layout", () => {
    expect(resolveViewportLayout({ height: 640, width: 390 })).toEqual({
      compact: true,
      dense: true,
      fontSize: stableWebFontSize,
      mode: "mobile"
    })
  })
})
