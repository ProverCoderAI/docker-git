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
})
