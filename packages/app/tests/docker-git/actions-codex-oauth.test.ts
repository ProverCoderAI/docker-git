/* jscpd:ignore-start */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import { codexLoginStreamMarkers } from "../../src/shared/auth-stream-markers.js"
import { runCodexOauthMutation } from "../../src/web/actions-codex-oauth.js"
import type { AuthSnapshot, GithubAuthStatus } from "../../src/web/api.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const loginCodexStreamMock = vi.hoisted(() => vi.fn())
const loadAuthSnapshotMock = vi.hoisted(() => vi.fn())
const loadGithubStatusMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/api.js", () => ({
  loadAuthSnapshot: loadAuthSnapshotMock,
  loadGithubStatus: loadGithubStatusMock,
  loginCodexStream: loginCodexStreamMock
}))

const githubStatus: GithubAuthStatus = {
  summary: "GitHub tokens (0):",
  tokens: []
}

const authSnapshot: AuthSnapshot = {
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
}

describe("web Codex OAuth action", () => {
  it.effect("uses the Codex login stream and refreshes the auth snapshot", () =>
    Effect.gen(function*(_) {
      loginCodexStreamMock.mockImplementation((_label: string | null, onChunk: (chunk: string) => void) =>
        Effect.sync(() => {
          onChunk("Open this URL to sign in: https://auth.openai.com/example\n")
          onChunk(`${codexLoginStreamMarkers.success}\n`)
          return [
            "Open this URL to sign in: https://auth.openai.com/example",
            codexLoginStreamMarkers.success
          ].join("\n")
        })
      )
      loadAuthSnapshotMock.mockImplementation(() => Effect.succeed(authSnapshot))
      loadGithubStatusMock.mockImplementation(() => Effect.succeed(githubStatus))

      const { context, output, setMessage } = makeBrowserActionContext()

      runCodexOauthMutation({ label: "" }, context)

      yield* _(waitForAssertion(() => {
        expect(context.setAuthSnapshot).toHaveBeenCalledWith(authSnapshot)
      }))

      expect(output()).toBe("Open this URL to sign in: https://auth.openai.com/example\n")
      expect(context.setActionPrompt).toHaveBeenCalledWith(null)
      expect(context.setGithubStatus).toHaveBeenCalledWith(githubStatus)
      expect(setMessage).toHaveBeenLastCalledWith("Saved Codex login (default).")
    }))
})
/* jscpd:ignore-end */
