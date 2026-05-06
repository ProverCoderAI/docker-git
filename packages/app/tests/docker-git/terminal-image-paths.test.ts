import { describe, expect, it } from "@effect/vitest"

import {
  detectTerminalImagePathMatches,
  detectTerminalImagePaths,
  isSupportedTerminalImagePath,
  stripTerminalAnsi
} from "../../src/web/terminal-image-paths.js"

describe("terminal image path detection", () => {
  it("detects a single absolute image path", () => {
    expect(detectTerminalImagePaths("see /var/data/issue232-main.png for details")).toEqual([
      "/var/data/issue232-main.png"
    ])
  })

  it("returns match ranges for clickable image paths", () => {
    expect(detectTerminalImagePathMatches("see /var/data/a.png.")).toEqual([
      {
        endIndex: 19,
        path: "/var/data/a.png",
        startIndex: 4
      }
    ])
  })

  it("detects multiple distinct image paths", () => {
    const text = "saved /var/data/a.png and /var/data/sub/b.jpg, also /home/user/c.webp"
    expect(detectTerminalImagePaths(text)).toEqual([
      "/var/data/a.png",
      "/var/data/sub/b.jpg",
      "/home/user/c.webp"
    ])
  })

  it("deduplicates repeated image paths", () => {
    expect(detectTerminalImagePaths("a /var/data/x.png b /var/data/x.png c")).toEqual(["/var/data/x.png"])
  })

  it("ignores relative paths", () => {
    expect(detectTerminalImagePaths("./relative.png and image.jpg here")).toEqual([])
  })

  it("ignores unsupported extensions", () => {
    expect(detectTerminalImagePaths("/var/data/file.txt /var/data/photo.bmp /var/data/doc.pdf")).toEqual([])
  })

  it("trims trailing punctuation from detected paths", () => {
    expect(detectTerminalImagePaths("look at /var/data/foo.png, then /var/data/bar.gif.")).toEqual([
      "/var/data/foo.png",
      "/var/data/bar.gif"
    ])
  })

  it("recognises uppercase extensions", () => {
    expect(detectTerminalImagePaths("/var/data/Photo.PNG /var/data/Cover.JPG")).toEqual([
      "/var/data/Photo.PNG",
      "/var/data/Cover.JPG"
    ])
  })

  it("strips ANSI CSI sequences before scanning", () => {
    const escapeChar = String.fromCodePoint(0x1B)
    const text = `${escapeChar}[32m/var/data/colored.png${escapeChar}[0m`
    expect(stripTerminalAnsi(text)).toBe("/var/data/colored.png")
    expect(detectTerminalImagePaths(text)).toEqual(["/var/data/colored.png"])
  })

  it("strips ANSI OSC sequences terminated by BEL or ST", () => {
    const escapeChar = String.fromCodePoint(0x1B)
    const bellChar = String.fromCodePoint(0x07)
    const belTerminated = `${escapeChar}]0;title${bellChar}/var/data/bel.png`
    const stTerminated = String.raw`${escapeChar}]0;title${escapeChar}\/var/data/st.png`
    expect(stripTerminalAnsi(belTerminated)).toBe("/var/data/bel.png")
    expect(stripTerminalAnsi(stTerminated)).toBe("/var/data/st.png")
    expect(detectTerminalImagePaths(belTerminated)).toEqual(["/var/data/bel.png"])
    expect(detectTerminalImagePaths(stTerminated)).toEqual(["/var/data/st.png"])
  })

  it("classifies supported image extensions", () => {
    expect(isSupportedTerminalImagePath("/var/data/a.png")).toBe(true)
    expect(isSupportedTerminalImagePath("/var/data/a.JPG")).toBe(true)
    expect(isSupportedTerminalImagePath("/var/data/a.jpeg")).toBe(true)
    expect(isSupportedTerminalImagePath("/var/data/a.gif")).toBe(true)
    expect(isSupportedTerminalImagePath("/var/data/a.webp")).toBe(true)
    expect(isSupportedTerminalImagePath("/var/data/a.bmp")).toBe(false)
    expect(isSupportedTerminalImagePath("/var/data/a.txt")).toBe(false)
  })
})
