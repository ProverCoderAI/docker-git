import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { expectParseErrorTag, parseOrThrow } from "./parser-helpers.js"

type AuthGitlabLoginCommand = Extract<ReturnType<typeof parseOrThrow>, { readonly _tag: "AuthGitlabLogin" }>

const expectGitlabLoginCommand = (
  args: ReadonlyArray<string>,
  verify: (command: AuthGitlabLoginCommand) => void
) =>
  Effect.sync(() => {
    const command = parseOrThrow(args)
    expect(command._tag).toBe("AuthGitlabLogin")
    if (command._tag !== "AuthGitlabLogin") {
      throw new Error("expected AuthGitlabLogin command")
    }
    verify(command)
  })

describe("parse auth commands", () => {
  it.effect("parses grok auth commands into the controller-owned auth directory", () =>
    Effect.sync(() => {
      const login = parseOrThrow(["auth", "grok", "login", "--label", "Team A", "--web"])
      const status = parseOrThrow(["auth", "grok", "status", "--label", "Team A"])
      const logout = parseOrThrow(["auth", "grok", "logout", "--label", "Team A"])

      expect(login._tag).toBe("AuthGrokLogin")
      expect(status._tag).toBe("AuthGrokStatus")
      expect(logout._tag).toBe("AuthGrokLogout")

      if (login._tag !== "AuthGrokLogin" || status._tag !== "AuthGrokStatus" || logout._tag !== "AuthGrokLogout") {
        throw new Error("expected AuthGrok commands")
      }

      expect(login.label).toBe("Team A")
      expect(login.grokAuthPath).toBe(".docker-git/.orch/auth/grok")
      expect(login.isWeb).toBe(true)
      expect(status.grokAuthPath).toBe(".docker-git/.orch/auth/grok")
      expect(logout.grokAuthPath).toBe(".docker-git/.orch/auth/grok")
    }))

  it.effect("parses codex auth import into the controller-owned auth directory", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["auth", "codex", "import"])
      expect(command._tag).toBe("AuthCodexImport")
      if (command._tag !== "AuthCodexImport") {
        throw new Error("expected AuthCodexImport command")
      }
      expect(command.codexAuthPath).toBe(".docker-git/.orch/auth/codex")
    }))

  it.effect("parses claude auth status into the controller-owned auth directory", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["auth", "claude", "status", "--label", "Team A"])
      expect(command._tag).toBe("AuthClaudeStatus")
      if (command._tag !== "AuthClaudeStatus") {
        throw new Error("expected AuthClaudeStatus command")
      }
      expect(command.label).toBe("Team A")
      expect(command.claudeAuthPath).toBe(".docker-git/.orch/auth/claude")
    }))

  it.effect("parses gitlab token login", () =>
    expectGitlabLoginCommand(["auth", "gitlab", "login", "--label", "Team A", "--token", "glpat-token"], (command) => {
      expect(command.label).toBe("Team A")
      expect(command.token).toBe("glpat-token")
      expect(command.envGlobalPath).toBe(".docker-git/.orch/env/global.env")
    }))

  it.effect("parses gitlab web login without token", () =>
    expectGitlabLoginCommand(["auth", "gitlab", "login", "--web"], (command) => {
      expect(command.token).toBeNull()
    }))

  it.effect("parses gitlab status and logout", () =>
    Effect.sync(() => {
      const status = parseOrThrow(["auth", "gitlab", "status"])
      const logout = parseOrThrow(["auth", "gitlab", "logout", "--label", "work"])
      expect(status._tag).toBe("AuthGitlabStatus")
      expect(logout._tag).toBe("AuthGitlabLogout")
      if (logout._tag !== "AuthGitlabLogout") {
        throw new Error("expected AuthGitlabLogout command")
      }
      expect(logout.label).toBe("work")
    }))

  it.effect("rejects gitlab login scopes", () =>
    expectParseErrorTag(["auth", "gitlab", "login", "--scopes", "api"], "InvalidOption"))

  // CHANGE: parse `auth git login|status|logout` for generic per-host git providers
  // WHY: issue #368 wants git connections to providers other than github/gitlab via a token
  // QUOTE(ТЗ): "реализовать возможность добавлять git подключения отличных от gitlab, github ... просто здавая токен"
  // REF: issue-368
  // SOURCE: n/a
  // FORMAT THEOREM: parse(["auth","git","login","--host",h,"--token",t]) = AuthGitLogin{host:h,token:t}
  // PURITY: CORE
  // EFFECT: n/a
  // INVARIANT: login/logout require --host; login requires --token and forbids --scopes
  // COMPLEXITY: O(1)
  it.effect("parses generic git token login with host and optional user", () =>
    Effect.sync(() => {
      const command = parseOrThrow([
        "auth",
        "git",
        "login",
        "--host",
        "git.example.com",
        "--token",
        "glpat-generic",
        "--user",
        "deploy-bot"
      ])
      expect(command._tag).toBe("AuthGitLogin")
      if (command._tag !== "AuthGitLogin") {
        throw new Error("expected AuthGitLogin command")
      }
      expect(command.host).toBe("git.example.com")
      expect(command.token).toBe("glpat-generic")
      expect(command.user).toBe("deploy-bot")
      expect(command.envGlobalPath).toBe(".docker-git/.orch/env/global.env")
    }))

  it.effect("parses generic git status and logout", () =>
    Effect.sync(() => {
      const status = parseOrThrow(["auth", "git", "status"])
      const logout = parseOrThrow(["auth", "git", "logout", "--host", "git.example.com"])
      expect(status._tag).toBe("AuthGitStatus")
      expect(logout._tag).toBe("AuthGitLogout")
      if (logout._tag !== "AuthGitLogout") {
        throw new Error("expected AuthGitLogout command")
      }
      expect(logout.host).toBe("git.example.com")
    }))

  it.effect("rejects generic git login without --host", () =>
    expectParseErrorTag(["auth", "git", "login", "--token", "t"], "MissingRequiredOption"))

  it.effect("rejects generic git login without --token", () =>
    expectParseErrorTag(["auth", "git", "login", "--host", "git.example.com"], "MissingRequiredOption"))

  it.effect("rejects generic git login scopes", () =>
    expectParseErrorTag(
      ["auth", "git", "login", "--host", "git.example.com", "--token", "t", "--scopes", "api"],
      "InvalidOption"
    ))

  it.effect("rejects generic git logout without --host", () =>
    expectParseErrorTag(["auth", "git", "logout"], "MissingRequiredOption"))
})
