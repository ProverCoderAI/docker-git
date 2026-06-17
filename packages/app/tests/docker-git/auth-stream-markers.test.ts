import { describe, expect, it } from "vitest"

import {
  authStreamMarkerExitCode,
  authStreamVisibleLines,
  codexLoginFailureMessage,
  codexLoginStreamMarkers,
  didAuthStreamSucceed,
  githubLoginFailureMessage,
  githubLoginStreamMarkers,
  gitlabLoginFailureMessage,
  gitlabLoginStreamMarkers,
  makeVisibleAuthStreamWriter
} from "../../src/shared/auth-stream-markers.js"

describe("auth stream markers", () => {
  it("detects GitHub stream success markers", () => {
    const output = [
      "Copy your one-time code: ABCD-1234",
      githubLoginStreamMarkers.success
    ].join("\n")

    expect(didAuthStreamSucceed(output, githubLoginStreamMarkers)).toBe(true)
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

  it("detects GitLab stream markers and failure messages", () => {
    const output = [
      "GitLab login failed",
      `${gitlabLoginStreamMarkers.errorPrefix}post-login`
    ].join("\n")

    expect(didAuthStreamSucceed(`${gitlabLoginStreamMarkers.success}\n`, gitlabLoginStreamMarkers)).toBe(true)
    expect(authStreamMarkerExitCode(output, gitlabLoginStreamMarkers)).toBe("post-login")
    expect(gitlabLoginFailureMessage(output, "post-login")).toBe("GitLab login failed")
    expect(authStreamVisibleLines(output, gitlabLoginStreamMarkers)).toEqual(["GitLab login failed"])
  })

  it("detects Codex stream markers and rate-limit failures", () => {
    const output = [
      "Codex login failed: 429 Too Many Requests",
      `${codexLoginStreamMarkers.errorPrefix}1`
    ].join("\n")

    expect(didAuthStreamSucceed(`${codexLoginStreamMarkers.success}\n`, codexLoginStreamMarkers)).toBe(true)
    expect(authStreamMarkerExitCode(output, codexLoginStreamMarkers)).toBe("1")
    expect(codexLoginFailureMessage(output, "1")).toContain("rate-limited")
    expect(authStreamVisibleLines(output, codexLoginStreamMarkers)).toEqual([
      "Codex login failed: 429 Too Many Requests"
    ])
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
