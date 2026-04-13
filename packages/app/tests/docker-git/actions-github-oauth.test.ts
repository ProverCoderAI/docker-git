import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import { githubLoginStreamMarkers } from "../../src/shared/auth-stream-markers.js"
import { runGithubOauthMutation } from "../../src/web/actions-github-oauth.js"
import type { BrowserActionContext } from "../../src/web/actions-shared.js"
import type { AuthSnapshot, GithubAuthStatus } from "../../src/web/api.js"

const loginGithubStreamMock = vi.hoisted(() => vi.fn())
const loadAuthSnapshotMock = vi.hoisted(() => vi.fn())
const loadGithubStatusMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/api.js", () => ({
  loadAuthSnapshot: loadAuthSnapshotMock,
  loadGithubStatus: loadGithubStatusMock,
  loginGithubStream: loginGithubStreamMock
}))

const githubStatus: GithubAuthStatus = {
  summary: "GitHub tokens (1):",
  tokens: [
    {
      key: "GITHUB_TOKEN",
      label: "default",
      login: "octocat",
      status: "valid"
    }
  ]
}

const authSnapshot: AuthSnapshot = {
  claudeAuthEntries: 0,
  claudeAuthPath: "/home/dev/.docker-git/.orch/auth/claude",
  geminiAuthEntries: 0,
  geminiAuthPath: "/home/dev/.docker-git/.orch/auth/gemini",
  gitTokenEntries: 0,
  gitUserEntries: 0,
  githubTokenEntries: 1,
  globalEnvPath: "/home/dev/.docker-git/.orch/env/global.env",
  totalEntries: 1
}

const makeContext = () => {
  let output = ""
  const setOutput: BrowserActionContext["setOutput"] = (next) => {
    output = typeof next === "function" ? next(output) : next
  }
  const setMessage: BrowserActionContext["setMessage"] = vi.fn()
  const reloadDashboard = vi.fn()

  return {
    context: {
      githubStatus: null,
      reloadDashboard,
      selectedProjectId: null,
      selectedProjectName: null,
      setActionPrompt: vi.fn(),
      setAuthSnapshot: vi.fn(),
      setBusyLabel: vi.fn(),
      setGithubStatus: vi.fn(),
      setMessage,
      setOutput,
      setProjectAuthSnapshot: vi.fn(),
      setSelectedMenuIndex: vi.fn(),
      setSelectedProject: vi.fn(),
      setSelectedProjectId: vi.fn(),
      setTerminalSession: vi.fn()
    } satisfies BrowserActionContext,
    output: () => output,
    reloadDashboard,
    setMessage
  }
}

describe("web GitHub OAuth action", () => {
  it.effect("refreshes dashboard projects after successful OAuth", () =>
    Effect.gen(function*(_) {
      loginGithubStreamMock.mockImplementation((_label: string | null, onChunk: (chunk: string) => void) =>
        Effect.sync(() => {
          onChunk("Copy your one-time code: ABCD-1234\n")
          onChunk("State dir ready: /home/dev/.docker-git\n")
          onChunk(`${githubLoginStreamMarkers.success}\n`)
          return [
            "Copy your one-time code: ABCD-1234",
            "State dir ready: /home/dev/.docker-git",
            githubLoginStreamMarkers.success
          ].join("\n")
        })
      )
      loadAuthSnapshotMock.mockImplementation(() => Effect.succeed(authSnapshot))
      loadGithubStatusMock.mockImplementation(() => Effect.succeed(githubStatus))

      const { context, output, reloadDashboard, setMessage } = makeContext()

      runGithubOauthMutation({ label: "" }, context)

      yield* _(
        Effect.tryPromise({
          catch: (error) => error,
          try: () =>
            vi.waitFor(() => {
              expect(reloadDashboard).toHaveBeenCalledTimes(1)
            })
        })
      )

      expect(output()).toBe("Copy your one-time code: ABCD-1234\nState dir ready: /home/dev/.docker-git\n")
      expect(context.setActionPrompt).toHaveBeenCalledWith(null)
      expect(context.setAuthSnapshot).toHaveBeenCalledWith(authSnapshot)
      expect(context.setGithubStatus).toHaveBeenCalledWith(githubStatus)
      expect(setMessage).toHaveBeenLastCalledWith("Saved GitHub token (default).")
    }))
})
