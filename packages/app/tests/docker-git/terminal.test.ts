import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach, vi } from "vitest"

import {
  createTerminalPasteGuard,
  extractTerminalImageBase64,
  isTerminalPasteShortcut
} from "../../src/web/terminal-image-paste.js"
import { resolveTerminalImageBasePath, resolveTerminalImageFetchUrl } from "../../src/web/terminal-image-url.js"
import {
  resolveTerminalCompactHeaderMode,
  resolveTerminalTypingMode,
  shouldShowTerminalTabs
} from "../../src/web/terminal-mobile-layout.js"
import { resolveTerminalReconnectDelay } from "../../src/web/terminal-reconnect.js"
import {
  parseTerminalServerMessage,
  projectSshRoutePath,
  resolveTerminalWebSocketUrl,
  terminalRouteToken,
  terminalTitleById
} from "../../src/web/terminal.js"
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

const stubSameOriginLocation = (host: string, httpProtocol: string): void => {
  resolveApiBaseUrlMock.mockReturnValue("/api")
  vi.stubGlobal("location", {
    hostname: host,
    origin: `${httpProtocol}//${host}:4176`,
    protocol: httpProtocol
  })
}

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

    stubSameOriginLocation(host, httpProtocol)

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

  it("builds stable project SSH routes with optional terminal selectors", () => {
    expect(projectSshRoutePath("octocat/hello-world")).toBe("/ssh/octocat/hello-world")
    expect(projectSshRoutePath("octocat/hello world", "a5f1c873-358b-4de9-9444-92ee8f8522fb")).toBe(
      "/ssh/octocat/hello%20world?t=a5f1c873"
    )
    expect(projectSshRoutePath("octocat/hello world", "session/1")).toBe("/ssh/octocat/hello%20world?t=session%2F1")
  })

  it("shortens UUID terminal selectors while preserving non-UUID ids", () => {
    expect(terminalRouteToken("a5f1c873-358b-4de9-9444-92ee8f8522fb")).toBe("a5f1c873")
    expect(terminalRouteToken("session-1")).toBe("session-1")
  })

  it("builds stable human terminal titles from creation order", () => {
    expect(
      [
        ...terminalTitleById([
          { createdAt: "2026-04-08T10:02:00.000Z", id: "session-b" },
          { createdAt: "2026-04-08T10:01:00.000Z", id: "session-a" }
        ]).entries()
      ]
    ).toEqual([
      ["session-a", "Terminal 1"],
      ["session-b", "Terminal 2"]
    ])
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

  it("converts /ws suffix into /image base path", () => {
    expect(resolveTerminalImageBasePath("/projects/by-key/proj/terminal-sessions/sess/ws")).toBe(
      "/projects/by-key/proj/terminal-sessions/sess/image"
    )
  })

  it("builds an absolute backend image url with path query parameter", () => {
    resolveApiBaseUrlMock.mockReturnValue("https://controller.example/api")

    expect(
      resolveTerminalImageFetchUrl(
        "/projects/by-key/proj%201/terminal-sessions/sess%2F2/ws",
        "/var/data/sample image.png"
      )
    ).toBe(
      "https://controller.example/api/projects/by-key/proj%201/terminal-sessions/sess%2F2/image?path=%2Fvar%2Fdata%2Fsample+image.png"
    )
  })

  it("uses same-origin api proxy for relative image fetch urls", () => {
    const host = "terminal.example.local"
    const httpProtocol = ["ht", "tp:"].join("")

    stubSameOriginLocation(host, httpProtocol)

    expect(
      resolveTerminalImageFetchUrl("/projects/proj/terminal-sessions/sess/ws", "/var/data/file.png")
    ).toBe(`${httpProtocol}//${host}:4176/api/projects/proj/terminal-sessions/sess/image?path=%2Fvar%2Fdata%2Ffile.png`)
  })
})
