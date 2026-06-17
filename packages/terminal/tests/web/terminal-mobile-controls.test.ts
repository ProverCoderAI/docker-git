import { describe, expect, it } from "vitest"

import {
  isModifierOnlyTerminalKey,
  mobileTerminalKeyInput,
  terminalControlCharacterForKey
} from "../../src/web/terminal-mobile-controls.js"

describe("terminal-mobile-controls", () => {
  it("maps mobile terminal buttons to terminal input sequences", () => {
    expect(mobileTerminalKeyInput("escape")).toBe("\u{1B}")
    expect(mobileTerminalKeyInput("tab")).toBe("\t")
    expect(mobileTerminalKeyInput("ctrl-c")).toBe("\u{3}")
    expect(mobileTerminalKeyInput("up")).toBe("\u{1B}[A")
    expect(mobileTerminalKeyInput("down")).toBe("\u{1B}[B")
    expect(mobileTerminalKeyInput("right")).toBe("\u{1B}[C")
    expect(mobileTerminalKeyInput("left")).toBe("\u{1B}[D")
  })

  it("derives control characters from keyboard keys for one-shot ctrl", () => {
    expect(terminalControlCharacterForKey("c")).toBe("\u{3}")
    expect(terminalControlCharacterForKey("C")).toBe("\u{3}")
    expect(terminalControlCharacterForKey("[")).toBe("\u{1B}")
    expect(terminalControlCharacterForKey("\\")).toBe("\u{1C}")
    expect(terminalControlCharacterForKey("]")).toBe("\u{1D}")
    expect(terminalControlCharacterForKey("^")).toBe("\u{1E}")
    expect(terminalControlCharacterForKey("_")).toBe("\u{1F}")
    expect(terminalControlCharacterForKey("?")).toBeNull()
  })

  it("recognizes modifier-only keys that should not consume one-shot ctrl", () => {
    expect(isModifierOnlyTerminalKey("Shift")).toBe(true)
    expect(isModifierOnlyTerminalKey("Control")).toBe(true)
    expect(isModifierOnlyTerminalKey("Alt")).toBe(true)
    expect(isModifierOnlyTerminalKey("a")).toBe(false)
  })
})
