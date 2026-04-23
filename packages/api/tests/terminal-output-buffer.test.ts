import { describe, expect, it } from "vitest"

import {
  appendTerminalOutput,
  emptyTerminalOutputBuffer,
  renderTerminalOutputBuffer
} from "../src/services/terminal-output-buffer.js"

describe("terminal output replay buffer", () => {
  it("replays appended terminal output in order", () => {
    const buffer = appendTerminalOutput(
      appendTerminalOutput(emptyTerminalOutputBuffer, "first\n", 100),
      "second\n",
      100
    )

    expect(renderTerminalOutputBuffer(buffer)).toBe("first\nsecond\n")
  })

  it("keeps only the newest output when the replay budget is exceeded", () => {
    const buffer = appendTerminalOutput(
      appendTerminalOutput(emptyTerminalOutputBuffer, "abcdef", 8),
      "ghij",
      8
    )

    expect(buffer.charLength).toBe(8)
    expect(renderTerminalOutputBuffer(buffer)).toBe("cdefghij")
  })

  it("trims an oversized chunk to the replay budget", () => {
    const buffer = appendTerminalOutput(emptyTerminalOutputBuffer, "0123456789", 4)

    expect(buffer.charLength).toBe(4)
    expect(renderTerminalOutputBuffer(buffer)).toBe("6789")
  })
})
