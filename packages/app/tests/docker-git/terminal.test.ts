import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach, vi } from "vitest"

import { parseTerminalServerMessage, resolveTerminalWebSocketUrl } from "../../src/web/terminal.js"
import type { TerminalServerMessage } from "../../src/web/terminal.js"

const resolveApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string>())

const readyMessagePayload: TerminalServerMessage = {
  session: {
    createdAt: "2026-04-08T10:00:00.000Z",
    id: "session-1",
    projectId: "project-1",
    sshCommand: "ssh dev@127.0.0.1",
    status: "attached"
  },
  type: "ready"
}

vi.mock("../../src/web/api-http.js", () => ({
  resolveApiBaseUrl: resolveApiBaseUrlMock
}))

describe("browser terminal helpers", () => {
  beforeEach(() => {
    resolveApiBaseUrlMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("builds websocket url from api base url", () => {
    resolveApiBaseUrlMock.mockReturnValue("https://controller.example/api")

    expect(resolveTerminalWebSocketUrl("/projects/proj%201/terminal-sessions/sess%2F2/ws", 120, 40)).toBe(
      "wss://controller.example/api/projects/proj%201/terminal-sessions/sess%2F2/ws?cols=120&rows=40"
    )
  })

  it("uses same-origin api proxy for relative browser api paths", () => {
    const host = "terminal.example.local"
    const httpProtocol = ["ht", "tp:"].join("")
    const wsProtocol = ["ws", "://"].join("")

    resolveApiBaseUrlMock.mockReturnValue("/api")
    vi.stubGlobal("location", {
      hostname: host,
      origin: `${httpProtocol}//${host}:4176`,
      protocol: httpProtocol
    })

    expect(resolveTerminalWebSocketUrl("/projects/proj/terminal-sessions/sess/ws", 80, 24)).toBe([
      wsProtocol,
      host,
      ":4176/api/projects/proj/terminal-sessions/sess/ws?cols=80&rows=24"
    ].join(""))
  })

  it("parses ready terminal messages", () => {
    const parsed = parseTerminalServerMessage(JSON.stringify(readyMessagePayload))

    expect(parsed).toEqual(readyMessagePayload)
  })

  it("rejects malformed terminal messages", () => {
    expect(parseTerminalServerMessage("{\"type\":\"output\",\"data\":1}")).toBeNull()
  })
})
