import { describe, expect, it } from "vitest"

import {
  isProjectTerminalSession,
  shouldAllowTerminalMouseTracking,
  shouldSuppressTerminalAlternateScreen
} from "../../src/web/terminal-screen-policy.js"
import type { ActiveTerminalSession } from "../../src/web/terminal.js"

const baseSession: ActiveTerminalSession = {
  closePath: "/projects/by-key/demo/terminal-sessions/abc",
  exitMessage: "ended",
  header: "SSH terminal: demo",
  pendingDeleteMessage: "closed",
  readyMessage: "ready",
  session: {
    createdAt: "2026-04-21T00:00:00.000Z",
    id: "abc",
    projectId: "project-demo",
    sshCommand: "ssh dev@demo",
    status: "ready"
  },
  subtitle: "ssh dev@demo",
  websocketPath: "/projects/by-key/demo/terminal-sessions/abc/ws"
}

const projectSession: ActiveTerminalSession = {
  ...baseSession,
  browserProjectId: "project-demo",
  browserProjectKey: "project-key-demo",
  browserProjectName: "demo"
}

describe("terminal alternate screen suppression gating", () => {
  it("suppresses the alternate screen for tmux-backed project terminals", () => {
    // Project terminals run inside tmux: keeping the alternate screen off lets output
    // accumulate in xterm's scrollback so wheel scrolling can reveal earlier history.
    expect(shouldSuppressTerminalAlternateScreen(projectSession)).toBe(true)
    expect(shouldAllowTerminalMouseTracking(projectSession)).toBe(true)
  })

  it("keeps the alternate screen for non-project (auth) terminals", () => {
    expect(shouldSuppressTerminalAlternateScreen(baseSession)).toBe(false)
    expect(shouldAllowTerminalMouseTracking(baseSession)).toBe(false)
  })

  it("classifies project sessions by their browser project id", () => {
    expect(isProjectTerminalSession(projectSession)).toBe(true)
    expect(isProjectTerminalSession(baseSession)).toBe(false)
  })
})
