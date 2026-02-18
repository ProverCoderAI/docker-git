import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  findClaudeApiKeyByLabel,
  listClaudeApiKeys,
  resolveClaudeLabelForApiKey,
  resolveProjectClaudeApiKey,
  resolveProjectClaudeLabel
} from "../../src/server/claude.js"

const globalEnv = [
  "ANTHROPIC_API_KEY=sk-ant-default",
  "ANTHROPIC_API_KEY__WORK=sk-ant-work",
  ""
].join("\n")

describe("listClaudeApiKeys", () => {
  it.effect("lists labeled Claude keys", () =>
    Effect.sync(() => {
      expect(listClaudeApiKeys(globalEnv)).toEqual([
        { label: "default", apiKey: "sk-ant-default" },
        { label: "WORK", apiKey: "sk-ant-work" }
      ])
    }))
})

describe("findClaudeApiKeyByLabel", () => {
  it.effect("finds keys by normalized label", () =>
    Effect.sync(() => {
      expect(findClaudeApiKeyByLabel(globalEnv, "work")).toEqual({
        label: "WORK",
        apiKey: "sk-ant-work"
      })
      expect(findClaudeApiKeyByLabel(globalEnv, "missing")).toBeNull()
    }))
})

describe("project claude state", () => {
  it.effect("reads active project key and label", () =>
    Effect.sync(() => {
      const projectEnv = [
        "ANTHROPIC_API_KEY=sk-ant-work",
        "CLAUDE_AUTH_LABEL=WORK",
        ""
      ].join("\n")
      expect(resolveProjectClaudeApiKey(projectEnv)).toBe("sk-ant-work")
      expect(resolveProjectClaudeLabel(projectEnv)).toBe("WORK")
    }))

  it.effect("resolves label by key value", () =>
    Effect.sync(() => {
      expect(resolveClaudeLabelForApiKey(globalEnv, "sk-ant-default")).toBe("default")
      expect(resolveClaudeLabelForApiKey(globalEnv, "missing")).toBeNull()
    }))
})
