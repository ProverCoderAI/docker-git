import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import {
  appendTerminalOutput,
  emptyTerminalOutputBuffer,
  renderTerminalOutputBuffer,
  type TerminalOutputBuffer
} from "../../src/core/index.js"

const appendChunks = (
  chunks: ReadonlyArray<string>,
  budget: number,
  index = 0,
  buffer = emptyTerminalOutputBuffer
): TerminalOutputBuffer => {
  const chunk = chunks[index]
  if (chunk === undefined) {
    return buffer
  }
  return appendChunks(chunks, budget, index + 1, appendTerminalOutput(buffer, chunk, budget))
}

describe("terminal output replay buffer", () => {
  it.effect("replays appended terminal output in order", () =>
    Effect.sync(() => {
      const buffer = appendTerminalOutput(
        appendTerminalOutput(emptyTerminalOutputBuffer, "first\n", 100),
        "second\n",
        100
      )

      expect(renderTerminalOutputBuffer(buffer)).toBe("first\nsecond\n")
    }))

  it.effect("keeps only the newest output when the replay budget is exceeded", () =>
    Effect.sync(() => {
      const buffer = appendTerminalOutput(
        appendTerminalOutput(emptyTerminalOutputBuffer, "abcdef", 8),
        "ghij",
        8
      )

      expect(buffer.charLength).toBe(8)
      expect(renderTerminalOutputBuffer(buffer)).toBe("cdefghij")
    }))

  it.effect("trims an oversized chunk to the replay budget", () =>
    Effect.sync(() => {
      const buffer = appendTerminalOutput(emptyTerminalOutputBuffer, "0123456789", 4)

      expect(buffer.charLength).toBe(4)
      expect(renderTerminalOutputBuffer(buffer)).toBe("6789")
    }))

  it.effect("preserves replay budget and newest suffix for arbitrary chunks", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ maxLength: 32 }), { maxLength: 24 }),
          fc.integer({ min: 0, max: 256 }),
          (chunks, budget) => {
            const buffer = appendChunks(chunks, budget)
            const rendered = renderTerminalOutputBuffer(buffer)
            const allOutput = chunks.join("")
            const expected = allOutput.slice(Math.max(0, allOutput.length - budget))

            expect(buffer.charLength).toBeLessThanOrEqual(budget)
            expect(buffer.charLength).toBe(rendered.length)
            expect(rendered).toBe(expected)
          }
        ),
        { numRuns: 100 }
      )
    }))
})
