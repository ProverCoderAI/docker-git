import { describe, expect, it } from "@effect/vitest"
import { afterEach, vi } from "vitest"

import { openUrl, prepareOpenUrl } from "../../src/web/open-url.js"
import { makeBrowserOpenMockWindow, stubBrowserOpen } from "./browser-open-fixture.js"

describe("open-url helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("opens prepared async popups without noopener so the caller keeps the window handle", () => {
    const openedWindow = makeBrowserOpenMockWindow()
    const openMock = stubBrowserOpen(openedWindow)

    const prepared = prepareOpenUrl()

    expect(openMock).toHaveBeenCalledWith("about:blank", "_blank")
    expect(openedWindow.opener).toBeNull()
    expect(prepared.navigate("/api/projects/project-1/browser/novnc")).toBe(true)
    expect(openedWindow.location.href).toBe("/api/projects/project-1/browser/novnc")
    expect(openedWindow.focus).toHaveBeenCalledOnce()

    prepared.close()

    expect(openedWindow.close).toHaveBeenCalledOnce()
  })

  it("falls back to direct noopener open when the prepared popup is blocked", () => {
    const openedWindow = makeBrowserOpenMockWindow()
    const openMock = vi.fn((url: string) => url === "about:blank" ? null : openedWindow)
    vi.stubGlobal("open", openMock)

    const prepared = prepareOpenUrl()

    expect(prepared.navigate("/api/projects/project-1/browser/novnc")).toBe(true)
    expect(openMock).toHaveBeenNthCalledWith(1, "about:blank", "_blank")
    expect(openMock).toHaveBeenNthCalledWith(2, "/api/projects/project-1/browser/novnc", "_blank", "noopener")
  })

  it("reports direct opens as blocked when no browser open function exists", () => {
    vi.stubGlobal("open", null)

    expect(openUrl("/api/projects/project-1/browser/novnc")).toBe(false)
    expect(prepareOpenUrl().navigate("/api/projects/project-1/browser/novnc")).toBe(false)
  })
})
