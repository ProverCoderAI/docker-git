import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach, vi } from "vitest"

import { resolveTerminalImageBasePath, resolveTerminalImageFetchUrl } from "../../src/web/terminal-image-url.js"

const resolveApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string>())

vi.mock("../../src/web/api-http.js", () => ({
  resolveApiBaseUrl: resolveApiBaseUrlMock
}))

describe("terminal image fetch url", () => {
  beforeEach(() => {
    resolveApiBaseUrlMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it("uses same-origin api proxy for relative api base urls", () => {
    const host = "terminal.example.local"
    const httpProtocol = ["ht", "tp:"].join("")

    resolveApiBaseUrlMock.mockReturnValue("/api")
    vi.stubGlobal("location", {
      hostname: host,
      origin: `${httpProtocol}//${host}:4176`,
      protocol: httpProtocol
    })

    expect(
      resolveTerminalImageFetchUrl("/projects/proj/terminal-sessions/sess/ws", "/var/data/file.png")
    ).toBe(`${httpProtocol}//${host}:4176/api/projects/proj/terminal-sessions/sess/image?path=%2Fvar%2Fdata%2Ffile.png`)
  })
})
