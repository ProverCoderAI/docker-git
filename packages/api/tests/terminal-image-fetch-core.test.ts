import { describe, expect, it } from "@effect/vitest"

import { planTerminalImageFetch } from "../src/services/terminal-image-fetch-core.js"

describe("terminal image fetch core", () => {
  it("continues to accept an absolute path with a supported image extension", () => {
    expect(planTerminalImageFetch("/tmp/issue232-main.png")).toEqual({
      _tag: "ValidTerminalImageFetch",
      containerPath: "/tmp/issue232-main.png",
      mediaType: "image/png"
    })
  })

  it("accepts a file URL and normalizes it to an absolute container path", () => {
    expect(planTerminalImageFetch("file:///tmp/phantom-e2e.tuhl98/wallet-step-after-password.png")).toEqual({
      _tag: "ValidTerminalImageFetch",
      containerPath: "/tmp/phantom-e2e.tuhl98/wallet-step-after-password.png",
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

  it("rejects non-file URLs", () => {
    expect(planTerminalImageFetch("https://example.com/tmp/photo.png")).toEqual({
      _tag: "InvalidTerminalImageFetch",
      message: "Only file:// image URLs are supported."
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

  it("rejects traversal segments in file URLs before URL normalization", () => {
    expect(planTerminalImageFetch("file:///tmp/../etc/photo.png")).toMatchObject({
      _tag: "InvalidTerminalImageFetch",
      message: "Image path must not contain '.' or '..' segments."
    })
    expect(planTerminalImageFetch("file:///tmp/%2E%2E/etc/photo.png")).toMatchObject({
      _tag: "InvalidTerminalImageFetch",
      message: "Image path must not contain '.' or '..' segments."
    })
  })

  it("rejects unsafe file URL forms", () => {
    expect(planTerminalImageFetch("file://example.com/tmp/photo.png")).toMatchObject({
      _tag: "InvalidTerminalImageFetch",
      message: "Image file URL must point to a local path."
    })
    expect(planTerminalImageFetch("file:///tmp/photo.png?download=1")).toMatchObject({
      _tag: "InvalidTerminalImageFetch",
      message: "Image file URL must not include query or fragment."
    })
    expect(planTerminalImageFetch("file:///tmp/%2Fetc/photo.png")).toMatchObject({
      _tag: "InvalidTerminalImageFetch",
      message: "Image file URL must not contain encoded or backslash path separators."
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

  it("resolves a relative path against the provided absolute base directory", () => {
    expect(
      planTerminalImageFetch(
        "app/docs/screenshots/issue-237/proof/pr238-proof-06-skiller-submodule-status.png",
        { baseDir: "/home/dev" }
      )
    ).toEqual({
      _tag: "ValidTerminalImageFetch",
      containerPath: "/home/dev/app/docs/screenshots/issue-237/proof/pr238-proof-06-skiller-submodule-status.png",
      mediaType: "image/png"
    })
  })

  it("ignores trailing slashes on the base directory when resolving a relative path", () => {
    expect(planTerminalImageFetch("photos/cover.jpg", { baseDir: "/home/dev/" })).toEqual({
      _tag: "ValidTerminalImageFetch",
      containerPath: "/home/dev/photos/cover.jpg",
      mediaType: "image/jpeg"
    })
  })

  it("still rejects relative paths when no base directory is supplied", () => {
    expect(planTerminalImageFetch("app/cover.png")).toEqual({
      _tag: "InvalidTerminalImageFetch",
      message: "Image path must be absolute."
    })
  })

  it("rejects relative paths when the supplied base directory is not absolute", () => {
    expect(planTerminalImageFetch("app/cover.png", { baseDir: "home/dev" })).toEqual({
      _tag: "InvalidTerminalImageFetch",
      message: "Image path must be absolute."
    })
  })

  it("rejects an unsafe base directory containing traversal segments", () => {
    expect(planTerminalImageFetch("cover.png", { baseDir: "/home/dev/../etc" })).toEqual({
      _tag: "InvalidTerminalImageFetch",
      message: "Image base directory is invalid."
    })
  })

  it("rejects relative paths that contain traversal segments after resolution", () => {
    expect(planTerminalImageFetch("../etc/cover.png", { baseDir: "/home/dev" })).toMatchObject({
      _tag: "InvalidTerminalImageFetch",
      message: "Image path must not contain '.' or '..' segments."
    })
  })
})
