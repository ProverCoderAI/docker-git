import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import type { TerminalAuthFlow } from "../../src/docker-git/menu-auth-shared.js"
import { createAuthActionPrompt } from "../../src/web/action-prompt.js"
import { submitBrowserActionPrompt } from "../../src/web/actions-auth.js"
import type { TerminalSession } from "../../src/web/api.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const createAuthTerminalSessionMock = vi.hoisted(() => vi.fn())
const loginCodexStreamMock = vi.hoisted(() => vi.fn())
const loadAuthSnapshotMock = vi.hoisted(() => vi.fn())
const loadGithubStatusMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/api.js", () => ({
  createAuthTerminalSession: createAuthTerminalSessionMock,
  loadAuthSnapshot: loadAuthSnapshotMock,
  loadGithubStatus: loadGithubStatusMock,
  loadProjectAuthSnapshot: vi.fn(),
  loginCodexStream: loginCodexStreamMock,
  loginGithubStream: vi.fn(),
  logoutCodex: vi.fn(),
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

const assertTerminalOauthAction = (
  action: TerminalAuthFlow,
  title: string
) =>
  Effect.gen(function*(_) {
    createAuthTerminalSessionMock.mockImplementation(() => Effect.succeed(session))
    const addTerminalSession = vi.fn()
    const { context, setMessage } = makeBrowserActionContext({
      addTerminalSession
    })

    submitBrowserActionPrompt(createAuthActionPrompt(action), context)

    yield* _(waitForAssertion(() => {
      expect(addTerminalSession).toHaveBeenCalledTimes(1)
    }))

    expect(createAuthTerminalSessionMock).toHaveBeenCalledWith(action, null)
    expect(context.setActionPrompt).toHaveBeenCalledWith(null)
    expect(addTerminalSession).toHaveBeenCalledWith(expect.objectContaining({
      closePath: "/auth/terminal-sessions/auth-session-1",
      exitMessage: `${title} finished (default).`,
      header: title,
      pendingDeleteMessage: `${title} was closed before attach.`,
      readyMessage: `${title} started (default).`,
      session,
      subtitle: "ssh dev@auth",
      websocketPath: "/auth/terminal-sessions/auth-session-1/ws"
    }))
    expect(setMessage).toHaveBeenLastCalledWith(`${title} is opening in the embedded terminal.`)
  })

describe("web auth actions", () => {
  beforeEach(() => {
    createAuthTerminalSessionMock.mockReset()
    loginCodexStreamMock.mockReset()
    loadAuthSnapshotMock.mockReset()
    loadGithubStatusMock.mockReset()
  })

  it.effect("adds OAuth terminal sessions without replacing existing terminal state", () =>
    assertTerminalOauthAction("ClaudeOauth", "Claude Code OAuth"))

  it.effect("opens Grok OAuth through the same terminal-session path as docker-git auth grok login", () =>
    assertTerminalOauthAction("GrokOauth", "Grok CLI OAuth"))

  it.effect("opens Gemini OAuth through the shared terminal-session path", () =>
    assertTerminalOauthAction("GeminiOauth", "Gemini CLI OAuth"))

  it.effect("does not route Codex OAuth through a terminal session", () =>
    Effect.gen(function*(_) {
      loginCodexStreamMock.mockImplementation((_label: string | null, onChunk: (chunk: string) => void) =>
        Effect.sync(() => {
          onChunk("__DOCKER_GIT_CODEX_LOGIN_STATUS__:ok\n")
          return "__DOCKER_GIT_CODEX_LOGIN_STATUS__:ok\n"
        })
      )
      loadAuthSnapshotMock.mockImplementation(() =>
        Effect.succeed({
          claudeAuthEntries: 0,
          claudeAuthPath: "/home/dev/.docker-git/.orch/auth/claude",
          codexAuthEntries: 1,
          codexAuthPath: "/home/dev/.docker-git/.orch/auth/codex",
          geminiAuthEntries: 0,
          geminiAuthPath: "/home/dev/.docker-git/.orch/auth/gemini",
          grokAuthEntries: 0,
          grokAuthPath: "/home/dev/.docker-git/.orch/auth/grok",
          gitTokenEntries: 0,
          gitUserEntries: 0,
          githubTokenEntries: 0,
          globalEnvPath: "/home/dev/.docker-git/.orch/env/global.env",
          totalEntries: 0
        })
      )
      loadGithubStatusMock.mockImplementation(() => Effect.succeed({ summary: "GitHub tokens (0):", tokens: [] }))
      const { context } = makeBrowserActionContext()

      submitBrowserActionPrompt(createAuthActionPrompt("CodexOauth"), context)

      yield* _(waitForAssertion(() => {
        expect(context.setAuthSnapshot).toHaveBeenCalledTimes(1)
      }))

      expect(createAuthTerminalSessionMock).not.toHaveBeenCalled()
      expect(loginCodexStreamMock).toHaveBeenCalledWith(null, expect.any(Function))
    }))
})
