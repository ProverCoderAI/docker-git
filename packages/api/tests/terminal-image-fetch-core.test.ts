import { describe, expect, it } from "@effect/vitest"

import { planTerminalImageFetch } from "../src/services/terminal-image-fetch-core.js"

describe("terminal image fetch core", () => {
  it("accepts an absolute path with a supported image extension", () => {
    expect(planTerminalImageFetch("/tmp/issue232-main.png")).toEqual({
      _tag: "ValidTerminalImageFetch",
      containerPath: "/tmp/issue232-main.png",
      mediaType: "image/png"
    })
  })

  it("maps each supported extension to its media type", () => {
    expect(planTerminalImageFetch("/a.jpg")).toMatchObject({ mediaType: "image/jpeg" })
    expect(planTerminalImageFetch("/a.jpeg")).toMatchObject({ mediaType: "image/jpeg" })
    expect(planTerminalImageFetch("/a.gif")).toMatchObject({ mediaType: "image/gif" })
    expect(planTerminalImageFetch("/a.webp")).toMatchObject({ mediaType: "image/webp" })
    expect(planTerminalImageFetch("/a.PNG")).toMatchObject({ mediaType: "image/png" })
  })

  it("rejects an empty path", () => {
    expect(planTerminalImageFetch("")).toEqual({
      _tag: "InvalidTerminalImageFetch",
      message: "Image path is required."
    })
  })

  it("rejects a relative path", () => {
    expect(planTerminalImageFetch("tmp/photo.png")).toEqual({
      _tag: "InvalidTerminalImageFetch",
      message: "Image path must be absolute."
    })
  })

  it("rejects whitespace and control characters", () => {
    expect(planTerminalImageFetch("/tmp/has space.png")).toMatchObject({
      _tag: "InvalidTerminalImageFetch"
    })
    expect(planTerminalImageFetch("/tmp/has\nnewline.png")).toMatchObject({
      _tag: "InvalidTerminalImageFetch"
    })
  })

  it("rejects parent-directory and current-directory traversal segments", () => {
    expect(planTerminalImageFetch("/tmp/../etc/photo.png")).toMatchObject({
      _tag: "InvalidTerminalImageFetch"
    })
    expect(planTerminalImageFetch("/tmp/./photo.png")).toMatchObject({
      _tag: "InvalidTerminalImageFetch"
    })
  })

  it("rejects unsupported extensions", () => {
    expect(planTerminalImageFetch("/tmp/file.bmp")).toMatchObject({
      _tag: "InvalidTerminalImageFetch"
    })
    expect(planTerminalImageFetch("/tmp/file")).toMatchObject({
      _tag: "InvalidTerminalImageFetch"
    })
    expect(planTerminalImageFetch("/tmp/file.")).toMatchObject({
      _tag: "InvalidTerminalImageFetch"
    })
  })
})
