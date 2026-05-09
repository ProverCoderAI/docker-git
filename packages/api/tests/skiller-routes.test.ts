import { describe, expect, it } from "@effect/vitest"

import { parseSkillerRoute } from "../src/services/skiller.js"

describe("skiller routes", () => {
  it("keeps the terminal session id on session-scoped app routes", () => {
    expect(parseSkillerRoute("/api/ssh/session/terminal-proof/skiller/app/")).toEqual({
      _tag: "App",
      relativePath: "/",
      sessionId: "terminal-proof"
    })
    expect(parseSkillerRoute("/ssh/session/terminal-proof/skiller/trpc/list_projects")).toEqual({
      _tag: "Trpc",
      sessionId: "terminal-proof",
      upstreamPath: "/trpc/list_projects"
    })
    expect(parseSkillerRoute("/api/skiller/app/")).toEqual({
      _tag: "App",
      relativePath: "/",
      sessionId: null
    })
  })
})
