import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { parseOrThrow } from "./parser-helpers.js"

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
})
