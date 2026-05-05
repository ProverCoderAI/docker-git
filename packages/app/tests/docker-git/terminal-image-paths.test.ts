import { describe, expect, it } from "@effect/vitest"

import {
  detectTerminalImagePaths,
  isSupportedTerminalImagePath,
  stripTerminalAnsi
} from "../../src/web/terminal-image-paths.js"

describe("terminal image path detection", () => {
  it("detects a single absolute image path", () => {
    expect(detectTerminalImagePaths("see /tmp/issue232-main.png for details")).toEqual([
      "/tmp/issue232-main.png"
    ])
  })

  it("detects multiple distinct image paths", () => {
    const text = "saved /tmp/a.png and /var/data/b.jpg, also /home/user/c.webp"
    expect(detectTerminalImagePaths(text)).toEqual([
      "/tmp/a.png",
      "/var/data/b.jpg",
      "/home/user/c.webp"
    ])
  })

  it("deduplicates repeated image paths", () => {
    expect(detectTerminalImagePaths("a /tmp/x.png b /tmp/x.png c")).toEqual(["/tmp/x.png"])
  })

  it("ignores relative paths", () => {
    expect(detectTerminalImagePaths("./relative.png and image.jpg here")).toEqual([])
  })

  it("ignores unsupported extensions", () => {
    expect(detectTerminalImagePaths("/tmp/file.txt /tmp/photo.bmp /tmp/doc.pdf")).toEqual([])
  })

  it("trims trailing punctuation from detected paths", () => {
    expect(detectTerminalImagePaths("look at /tmp/foo.png, then /var/bar.gif.")).toEqual([
      "/tmp/foo.png",
      "/var/bar.gif"
    ])
  })

  it("recognises uppercase extensions", () => {
    expect(detectTerminalImagePaths("/tmp/Photo.PNG /tmp/Cover.JPG")).toEqual([
      "/tmp/Photo.PNG",
      "/tmp/Cover.JPG"
    ])
  })

  it("strips ANSI CSI sequences before scanning", () => {
    const text = `[32m/tmp/colored.png[0m`
    expect(stripTerminalAnsi(text)).toBe("/tmp/colored.png")
    expect(detectTerminalImagePaths(text)).toEqual(["/tmp/colored.png"])
  })

  it("strips ANSI OSC sequences terminated by BEL or ST", () => {
    const belTerminated = `]0;title/tmp/bel.png`
    const stTerminated = `]0;title\\/tmp/st.png`
    expect(stripTerminalAnsi(belTerminated)).toBe("/tmp/bel.png")
    expect(stripTerminalAnsi(stTerminated)).toBe("/tmp/st.png")
    expect(detectTerminalImagePaths(belTerminated)).toEqual(["/tmp/bel.png"])
    expect(detectTerminalImagePaths(stTerminated)).toEqual(["/tmp/st.png"])
  })

  it("classifies supported image extensions", () => {
    expect(isSupportedTerminalImagePath("/tmp/a.png")).toBe(true)
    expect(isSupportedTerminalImagePath("/tmp/a.JPG")).toBe(true)
    expect(isSupportedTerminalImagePath("/tmp/a.jpeg")).toBe(true)
    expect(isSupportedTerminalImagePath("/tmp/a.gif")).toBe(true)
    expect(isSupportedTerminalImagePath("/tmp/a.webp")).toBe(true)
    expect(isSupportedTerminalImagePath("/tmp/a.bmp")).toBe(false)
    expect(isSupportedTerminalImagePath("/tmp/a.txt")).toBe(false)
  })
})
