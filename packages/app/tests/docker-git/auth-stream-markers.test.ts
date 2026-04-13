import { describe, expect, it } from "vitest"

import {
  authStreamMarkerExitCode,
  authStreamSucceeded,
  authStreamVisibleLines,
  githubLoginFailureMessage,
  githubLoginStreamMarkers,
  makeVisibleAuthStreamWriter
} from "../../src/shared/auth-stream-markers.js"

describe("auth stream markers", () => {
  it("detects GitHub stream success markers", () => {
    const output = [
      "Copy your one-time code: ABCD-1234",
      githubLoginStreamMarkers.success
    ].join("\n")

    expect(authStreamSucceeded(output, githubLoginStreamMarkers)).toBe(true)
    expect(authStreamVisibleLines(output, githubLoginStreamMarkers)).toEqual([
      "Copy your one-time code: ABCD-1234"
    ])
  })

  it("extracts GitHub stream error markers", () => {
    const output = [
      "failed to authenticate",
      `${githubLoginStreamMarkers.errorPrefix}2`
    ].join("\n")

    expect(authStreamMarkerExitCode(output, githubLoginStreamMarkers)).toBe("2")
    expect(githubLoginFailureMessage(output, "2")).toBe("failed to authenticate")
  })

  it("filters marker lines from chunked visible output", () => {
    const chunks: Array<string> = []
    const writer = makeVisibleAuthStreamWriter(githubLoginStreamMarkers, (chunk) => {
      chunks.push(chunk)
    })

    writer.writeChunk("First line\n")
    writer.writeChunk(`${githubLoginStreamMarkers.success}\n`)
    writer.writeChunk("Last")
    writer.flushVisiblePending()

    expect(chunks.join("")).toBe("First line\nLast")
  })
})
