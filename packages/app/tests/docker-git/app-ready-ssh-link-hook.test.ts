import { describe, expect, it } from "vitest"

import { resolveMissingSshSessionFallbackPath } from "../../src/web/app-ready-ssh-link-hook.js"

describe("app-ready ssh link hook", () => {
  it("falls back to the Select screen for a stale SSH session route", () => {
    expect(
      resolveMissingSshSessionFallbackPath(
        "https://docker-git.local/ssh/session/session-1",
        "session-1",
        "HTTP 404"
      )
    ).toBe("/menu/select")
  })

  it("keeps the current route for non-404 session attach errors", () => {
    expect(
      resolveMissingSshSessionFallbackPath(
        "https://docker-git.local/ssh/session/session-1",
        "session-1",
        "HTTP 429: tunnel or proxy rate limited the request."
      )
    ).toBeNull()
  })

  it("ignores unrelated routes even when the API returns 404", () => {
    expect(
      resolveMissingSshSessionFallbackPath(
        "https://docker-git.local/browser/octocat/hello-world",
        "session-1",
        "HTTP 404"
      )
    ).toBeNull()
  })
})
