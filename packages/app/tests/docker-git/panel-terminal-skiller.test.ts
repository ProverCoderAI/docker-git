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

const renderTerminalPanel = (): string =>
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
    session
  }))

describe("TerminalPanel Skiller action", () => {
  it("renders Skiller in the project terminal header action row", () => {
    const html = renderTerminalPanel()

    const openBrowserIndex = html.indexOf("Open browser")
    const skillerIndex = html.indexOf("Skiller")
    const applyIndex = html.indexOf("Apply")

    expect(openBrowserIndex).toBeGreaterThanOrEqual(0)
    expect(skillerIndex).toBeGreaterThan(openBrowserIndex)
    expect(applyIndex).toBeGreaterThan(skillerIndex)
  })
})
