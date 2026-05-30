import { describe, expect, it } from "@effect/vitest"

import {
  createTerminalImagePastePlan,
  sanitizeTerminalImageBaseName,
  terminalImagePasteDirectory,
  terminalImagePasteMaxBytes
} from "@prover-coder-ai/docker-git-terminal/core"

describe("terminal image paste core", () => {
  it("creates a safe project-container path for supported images", () => {
    const plan = createTerminalImagePastePlan({
      data: "aGVsbG8=",
      mediaType: "image/png",
      name: "../screen shot.png",
      size: 5
    }, "paste-id")

    expect(plan).toEqual({
      _tag: "ValidTerminalImagePaste",
      containerPath: `${terminalImagePasteDirectory}/paste-id-screen-shot.png`,
      decodedBytes: 5,
      normalizedBase64: "aGVsbG8="
    })
  })

  it("rejects unsupported media types", () => {
    const plan = createTerminalImagePastePlan({
      data: "aGVsbG8=",
      mediaType: "image/svg+xml",
      name: "image.svg",
      size: 5
    }, "paste-id")

    expect(plan).toEqual({
      _tag: "InvalidTerminalImagePaste",
      message: "Unsupported image type: image/svg+xml."
    })
  })

  it("rejects mismatched base64 payload size", () => {
    const plan = createTerminalImagePastePlan({
      data: "aGVsbG8=",
      mediaType: "image/png",
      name: "image.png",
      size: 6
    }, "paste-id")

    expect(plan).toEqual({
      _tag: "InvalidTerminalImagePaste",
      message: "Image payload size does not match its base64 data."
    })
  })

  it("rejects images above the byte limit", () => {
    const plan = createTerminalImagePastePlan({
      data: "aGVsbG8=",
      mediaType: "image/png",
      name: "image.png",
      size: terminalImagePasteMaxBytes + 1
    }, "paste-id")

    expect(plan._tag).toBe("InvalidTerminalImagePaste")
  })

  it("sanitizes empty and unsafe file names", () => {
    expect(sanitizeTerminalImageBaseName("../../")).toBe("clipboard-image")
    expect(sanitizeTerminalImageBaseName("screen shot (final).png")).toBe("screen-shot-final")
  })
})
