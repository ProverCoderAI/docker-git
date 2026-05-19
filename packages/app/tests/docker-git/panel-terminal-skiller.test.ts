import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TerminalPanel } from "../../src/web/panel-terminal.js"
import type { ActiveTerminalSession } from "../../src/web/terminal.js"

vi.mock("../../src/web/terminal-panel-runtime.js", () => ({
  useTerminalSessionLifecycle: vi.fn()
}))

const projectId = "/home/dev/.docker-git/pr238-skiller-button-proof"

const session: ActiveTerminalSession = {
  browserProjectId: projectId,
  browserProjectKey: "0a278e578d69",
  browserProjectName: "provercoderai/docker-git",
  closePath: "/projects/by-key/0a278e578d69/terminal-sessions/proof",
  exitMessage: "SSH session ended.",
  header: "SSH terminal: provercoderai/docker-git",
  pendingConnection: {
    message: "Proof terminal workspace.",
    phase: "connecting"
  },
  pendingDeleteMessage: "Pending SSH terminal was closed before attach: provercoderai/docker-git.",
  readyMessage: "SSH connected: provercoderai/docker-git.",
  session: {
    createdAt: "2026-05-09T18:00:00.000Z",
    id: "proof-terminal",
    projectId,
    sshCommand: "ssh -tt -Y -o LogLevel=ERROR -p 2231 dev@localhost",
    status: "ready"
  },
  sessionPath: "/ssh/session/proof-terminal",
  subtitle: "ssh -tt -Y -o LogLevel=ERROR -p 2231 dev@localhost",
  websocketPath: "/projects/by-key/0a278e578d69/terminal-sessions/proof-terminal/ws"
}

type TerminalPanelRenderOverrides = Partial<Parameters<typeof TerminalPanel>[0]>

const renderTerminalPanel = (overrides: TerminalPanelRenderOverrides = {}): string =>
  renderToStaticMarkup(createElement(TerminalPanel, {
    keyboardOpen: false,
    mobileMode: false,
    onApplyProject: vi.fn(),
    onAttachFailure: vi.fn(),
    onDetach: vi.fn(),
    onKill: vi.fn(),
    onMessage: vi.fn(),
    onOpenBrowser: vi.fn(),
    onOpenSkiller: vi.fn(),
    onOpenTaskManager: vi.fn(),
    onOpenTerminal: vi.fn(),
    session,
    ...overrides
  }))

describe("TerminalPanel Skiller action", () => {
  it("keeps desktop terminal metadata and actions in separate rows", () => {
    const html = renderTerminalPanel()

    expect(html).toContain("align-items:stretch")
    expect(html).toContain("flex-direction:column")
    expect(html).toContain("width:100%")
    expect(html).toContain("text-overflow:ellipsis")
    expect(html).toContain("white-space:nowrap")
    expect(html).toContain(session.subtitle)
  })

  it("renders Skiller in the project terminal header action row", () => {
    const html = renderTerminalPanel()

    const openBrowserIndex = html.indexOf("Open browser")
    const skillerIndex = html.indexOf("Skiller")
    const applyIndex = html.indexOf("Apply")

    expect(openBrowserIndex).toBeGreaterThanOrEqual(0)
    expect(skillerIndex).toBeGreaterThan(openBrowserIndex)
    expect(applyIndex).toBeGreaterThan(skillerIndex)
  })

  it("renders automatic image previews enabled by default in the terminal header action row", () => {
    const html = renderTerminalPanel()

    const imagesIndex = html.indexOf("Images on")
    const detachIndex = html.indexOf("Detach")

    expect(imagesIndex).toBeGreaterThanOrEqual(0)
    expect(detachIndex).toBeGreaterThan(imagesIndex)
    expect(html).toContain("aria-pressed=\"true\"")
    expect(html).toContain("title=\"Automatic image previews enabled\"")
  })

  it("uses a compact image preview toggle label in compact terminal headers", () => {
    const html = renderTerminalPanel({ mobileMode: true })

    expect(html).toContain("flex-direction:row")
    expect(html).toContain("Img on")
    expect(html).not.toContain("Images on")
  })
})
