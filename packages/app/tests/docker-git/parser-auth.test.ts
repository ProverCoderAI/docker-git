import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { expectParseErrorTag, parseOrThrow } from "./parser-helpers.js"

describe("parse auth commands", () => {
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
    Effect.sync(() => {
      const command = parseOrThrow(["auth", "gitlab", "login", "--label", "Team A", "--token", "glpat-token"])
      expect(command._tag).toBe("AuthGitlabLogin")
      if (command._tag !== "AuthGitlabLogin") {
        throw new Error("expected AuthGitlabLogin command")
      }
      expect(command.label).toBe("Team A")
      expect(command.token).toBe("glpat-token")
      expect(command.envGlobalPath).toBe(".docker-git/.orch/env/global.env")
    }))

  it.effect("parses gitlab web login without token", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["auth", "gitlab", "login", "--web"])
      expect(command._tag).toBe("AuthGitlabLogin")
      if (command._tag !== "AuthGitlabLogin") {
        throw new Error("expected AuthGitlabLogin command")
      }
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
