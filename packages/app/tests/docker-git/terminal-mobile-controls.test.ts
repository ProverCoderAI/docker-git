import { describe, expect, it } from "vitest"

import {
  isModifierOnlyTerminalKey,
  mobileTerminalKeyInput,
  terminalControlCharacterForKey
} from "../../src/web/terminal-mobile-controls.js"

describe("terminal-mobile-controls", () => {
  it("maps mobile terminal buttons to terminal input sequences", () => {
    expect(mobileTerminalKeyInput("escape")).toBe("\u001b")
    expect(mobileTerminalKeyInput("tab")).toBe("\t")
    expect(mobileTerminalKeyInput("ctrl-c")).toBe("\u0003")
    expect(mobileTerminalKeyInput("up")).toBe("\u001b[A")
    expect(mobileTerminalKeyInput("down")).toBe("\u001b[B")
    expect(mobileTerminalKeyInput("right")).toBe("\u001b[C")
    expect(mobileTerminalKeyInput("left")).toBe("\u001b[D")
  })

  it("derives control characters from keyboard keys for one-shot ctrl", () => {
    expect(terminalControlCharacterForKey("c")).toBe("\u0003")
    expect(terminalControlCharacterForKey("C")).toBe("\u0003")
    expect(terminalControlCharacterForKey("[")).toBe("\u001b")
    expect(terminalControlCharacterForKey("\\")).toBe("\u001c")
    expect(terminalControlCharacterForKey("]")).toBe("\u001d")
    expect(terminalControlCharacterForKey("^")).toBe("\u001e")
    expect(terminalControlCharacterForKey("_")).toBe("\u001f")
    expect(terminalControlCharacterForKey("?")).toBeNull()
  })

  it("recognizes modifier-only keys that should not consume one-shot ctrl", () => {
    expect(isModifierOnlyTerminalKey("Shift")).toBe(true)
    expect(isModifierOnlyTerminalKey("Control")).toBe(true)
    expect(isModifierOnlyTerminalKey("Alt")).toBe(true)
    expect(isModifierOnlyTerminalKey("a")).toBe(false)
  })
})
