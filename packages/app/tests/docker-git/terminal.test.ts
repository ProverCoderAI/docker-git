import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach, vi } from "vitest"

import {
  resolveTerminalCompactHeaderMode,
  resolveTerminalTypingMode
} from "../../src/web/terminal-mobile-layout.js"
import { shouldShowTerminalTabs } from "../../src/web/terminal-mobile-layout.js"
import {
  createTerminalPasteGuard,
  extractTerminalImageBase64,
  isTerminalPasteShortcut
} from "../../src/web/terminal-image-paste.js"
import { resolveTerminalReconnectDelay } from "../../src/web/terminal-reconnect.js"
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

  it("caps reconnect backoff inside the server reconnect grace window", () => {
    expect([
      resolveTerminalReconnectDelay(-1),
      resolveTerminalReconnectDelay(0),
      resolveTerminalReconnectDelay(1),
      resolveTerminalReconnectDelay(2),
      resolveTerminalReconnectDelay(3)
    ]).toEqual([500, 500, 1000, 2000, 3000])
  })

  it("extracts base64 data from pasted image data urls", () => {
    expect(extractTerminalImageBase64("data:image/png;base64,aGVsbG8=")).toBe("aGVsbG8=")
    expect(extractTerminalImageBase64("plain-text")).toBeNull()
  })

  it("detects image paste shortcut without matching text paste shortcut", () => {
    expect(isTerminalPasteShortcut({ altKey: false, ctrlKey: true, key: "v", metaKey: false, shiftKey: false })).toBe(
      true
    )
    expect(isTerminalPasteShortcut({ altKey: false, ctrlKey: true, key: "v", metaKey: false, shiftKey: true })).toBe(
      false
    )
  })

  it("suppresses only the next native image paste control input", () => {
    let currentTimeMillis = 1000
    const pasteGuard = createTerminalPasteGuard(() => currentTimeMillis)

    expect(pasteGuard.shouldSuppressTerminalInput("\u0016")).toBe(false)
    pasteGuard.suppressNextNativeImagePaste()
    expect(pasteGuard.shouldSuppressTerminalInput("text")).toBe(false)
    expect(pasteGuard.shouldSuppressTerminalInput("\u0016")).toBe(true)
    expect(pasteGuard.shouldSuppressTerminalInput("\u0016")).toBe(false)

    pasteGuard.suppressNextNativeImagePaste()
    currentTimeMillis = 2000
    expect(pasteGuard.shouldSuppressTerminalInput("\u0016")).toBe(false)
  })

  it("uses compact terminal chrome on mobile and only enables typing mode with the keyboard open", () => {
    expect(resolveTerminalCompactHeaderMode(true)).toBe(true)
    expect(resolveTerminalCompactHeaderMode(false)).toBe(false)
    expect(resolveTerminalTypingMode(true, true)).toBe(true)
    expect(resolveTerminalTypingMode(true, false)).toBe(false)
    expect(resolveTerminalTypingMode(false, true)).toBe(false)
  })

  it("hides terminal tabs for a single mobile session and keeps them for multi-session or desktop layouts", () => {
    expect(shouldShowTerminalTabs(true, 1)).toBe(false)
    expect(shouldShowTerminalTabs(true, 2)).toBe(true)
    expect(shouldShowTerminalTabs(false, 1)).toBe(true)
  })
})
