import { describe, expect, it } from "@effect/vitest"

import {
  appendTerminalImageGalleryEntries,
  terminalImageGalleryLimit
} from "../../src/web/terminal-image-gallery-core.js"

const entry = (path: string) => ({ fetchUrl: `https://example/api/image?path=${path}`, path })

describe("terminal image gallery state", () => {
  it("returns existing list when nothing is added", () => {
    const current = [entry("/var/data/a.png")]
    expect(appendTerminalImageGalleryEntries(current, [])).toBe(current)
  })

  it("appends new entries while preserving order", () => {
    expect(
      appendTerminalImageGalleryEntries(
        [entry("/var/data/a.png")],
        [entry("/var/data/b.png"), entry("/var/data/c.png")]
      )
    ).toEqual([entry("/var/data/a.png"), entry("/var/data/b.png"), entry("/var/data/c.png")])
  })

  it("deduplicates entries already present", () => {
    expect(
      appendTerminalImageGalleryEntries(
        [entry("/var/data/a.png")],
        [entry("/var/data/a.png"), entry("/var/data/b.png")]
      )
    ).toEqual([entry("/var/data/a.png"), entry("/var/data/b.png")])
  })

  it("returns the same reference when all incoming entries are already known", () => {
    const current = [entry("/var/data/a.png")]
    expect(appendTerminalImageGalleryEntries(current, [entry("/var/data/a.png")])).toBe(current)
  })

  it("trims oldest entries to honor the limit", () => {
    const limit = 3
    expect(
      appendTerminalImageGalleryEntries(
        [entry("/a.png"), entry("/b.png"), entry("/c.png")],
        [entry("/d.png"), entry("/e.png")],
        limit
      )
    ).toEqual([entry("/c.png"), entry("/d.png"), entry("/e.png")])
  })

  it("exposes a default gallery limit", () => {
    expect(terminalImageGalleryLimit).toBeGreaterThan(0)
  })
})
