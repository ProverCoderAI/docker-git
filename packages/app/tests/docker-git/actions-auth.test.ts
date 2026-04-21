import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import { createAuthActionPrompt } from "../../src/web/action-prompt.js"
import { submitBrowserActionPrompt } from "../../src/web/actions-auth.js"
import type { TerminalSession } from "../../src/web/api.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const createAuthTerminalSessionMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/api.js", () => ({
  createAuthTerminalSession: createAuthTerminalSessionMock,
  loadAuthSnapshot: vi.fn(),
  loadGithubStatus: vi.fn(),
  loadProjectAuthSnapshot: vi.fn(),
  loginGithubStream: vi.fn(),
  runAuthMenuFlow: vi.fn(),
  runProjectAuthFlow: vi.fn()
}))

const session: TerminalSession = {
  createdAt: "2026-04-21T10:00:00.000Z",
  id: "auth-session-1",
  projectId: "auth",
  sshCommand: "ssh dev@auth",
  status: "ready"
}

describe("web auth actions", () => {
  beforeEach(() => {
    createAuthTerminalSessionMock.mockReset()
  })

  it.effect("adds OAuth terminal sessions without replacing existing terminal state", () =>
    Effect.gen(function*(_) {
      createAuthTerminalSessionMock.mockImplementation(() => Effect.succeed(session))
      const addTerminalSession = vi.fn()
      const { context, setMessage } = makeBrowserActionContext({
        addTerminalSession
      })

      submitBrowserActionPrompt(createAuthActionPrompt("ClaudeOauth"), context)

      yield* _(waitForAssertion(() => {
        expect(addTerminalSession).toHaveBeenCalledTimes(1)
      }))

      expect(createAuthTerminalSessionMock).toHaveBeenCalledWith("ClaudeOauth", null)
      expect(context.setActionPrompt).toHaveBeenCalledWith(null)
      expect(addTerminalSession).toHaveBeenCalledWith(expect.objectContaining({
        closePath: "/auth/terminal-sessions/auth-session-1",
        exitMessage: "Claude Code OAuth finished (default).",
        header: "Claude Code OAuth",
        pendingDeleteMessage: "Claude Code OAuth was closed before attach.",
        readyMessage: "Claude Code OAuth started (default).",
        session,
        subtitle: "ssh dev@auth",
        websocketPath: "/auth/terminal-sessions/auth-session-1/ws"
      }))
      expect(setMessage).toHaveBeenLastCalledWith("Claude Code OAuth is opening in the embedded terminal.")
    }))
})
