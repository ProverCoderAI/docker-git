import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  findGitCredentialByLabel,
  listGitCredentials,
  resolveGitLabelForToken,
  resolveProjectGitLabel,
  resolveProjectGitToken
} from "../../src/server/git-credentials.js"

const globalEnv = [
  "GIT_AUTH_TOKEN=token_default",
  "GIT_AUTH_USER=default-user",
  "GIT_AUTH_TOKEN__WORK=token_work",
  "GIT_AUTH_TOKEN__OPS=token_ops",
  "GIT_AUTH_USER__OPS=ops-user",
  ""
].join("\n")

describe("listGitCredentials", () => {
  it.effect("lists labeled git credentials with user fallback", () =>
    Effect.sync(() => {
      const credentials = listGitCredentials(globalEnv)
      expect(credentials).toEqual([
        { label: "default", token: "token_default", user: "default-user" },
        { label: "WORK", token: "token_work", user: "default-user" },
        { label: "OPS", token: "token_ops", user: "ops-user" }
      ])
    }))
})

describe("findGitCredentialByLabel", () => {
  it.effect("finds credentials by normalized label", () =>
    Effect.sync(() => {
      const selected = findGitCredentialByLabel(globalEnv, "work")
      expect(selected).toEqual({
        label: "WORK",
        token: "token_work",
        user: "default-user"
      })
    }))
})

describe("project git state", () => {
  it.effect("reads project git token and label", () =>
    Effect.sync(() => {
      const projectEnv = [
        "GIT_AUTH_TOKEN=token_ops",
        "GIT_AUTH_LABEL=OPS",
        ""
      ].join("\n")
      expect(resolveProjectGitToken(projectEnv)).toBe("token_ops")
      expect(resolveProjectGitLabel(projectEnv)).toBe("OPS")
    }))

  it.effect("resolves label by token value", () =>
    Effect.sync(() => {
      expect(resolveGitLabelForToken(globalEnv, "token_default")).toBe("default")
      expect(resolveGitLabelForToken(globalEnv, "token_work")).toBe("WORK")
      expect(resolveGitLabelForToken(globalEnv, "missing")).toBeNull()
    }))
})
