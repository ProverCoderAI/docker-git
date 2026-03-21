import { describe, expect, it } from "@effect/vitest"
import { gitBaseEnv } from "../../../src/usecases/state-repo/git-commands.js"

describe("git-commands", () => {
  describe("gitBaseEnv", () => {
    it("includes GIT_TERMINAL_PROMPT set to 0", () => {
      expect(gitBaseEnv.GIT_TERMINAL_PROMPT).toBe("0")
    })

    it("includes GIT_SSH_COMMAND to bypass prompt hanging", () => {
      expect(gitBaseEnv.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes")
    })
  })
})
