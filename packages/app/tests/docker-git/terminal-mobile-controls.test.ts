import { describe, expect, it } from "vitest"

import {
  isModifierOnlyTerminalKey,
  mobileTerminalKeyInput,
  terminalControlCharacterForKey
} from "../../src/web/terminal-mobile-controls.js"

describe("terminal-mobile-controls", () => {
  it("maps mobile terminal buttons to terminal input sequences", () => {
    expect(mobileTerminalKeyInput("escape")).toBe("\u001B")
    expect(mobileTerminalKeyInput("tab")).toBe("\t")
    expect(mobileTerminalKeyInput("ctrl-c")).toBe("\u0003")
    expect(mobileTerminalKeyInput("up")).toBe("\u001B[A")
    expect(mobileTerminalKeyInput("down")).toBe("\u001B[B")
    expect(mobileTerminalKeyInput("right")).toBe("\u001B[C")
    expect(mobileTerminalKeyInput("left")).toBe("\u001B[D")
  })

  it("derives control characters from keyboard keys for one-shot ctrl", () => {
    expect(terminalControlCharacterForKey("c")).toBe("\u0003")
    expect(terminalControlCharacterForKey("C")).toBe("\u0003")
    expect(terminalControlCharacterForKey("[")).toBe("\u001B")
    expect(terminalControlCharacterForKey("\\")).toBe("\u001C")
    expect(terminalControlCharacterForKey("]")).toBe("\u001D")
    expect(terminalControlCharacterForKey("^")).toBe("\u001E")
    expect(terminalControlCharacterForKey("_")).toBe("\u001F")
    expect(terminalControlCharacterForKey("?")).toBeNull()
  })

  it("recognizes modifier-only keys that should not consume one-shot ctrl", () => {
    expect(isModifierOnlyTerminalKey("Shift")).toBe(true)
    expect(isModifierOnlyTerminalKey("Control")).toBe(true)
    expect(isModifierOnlyTerminalKey("Alt")).toBe(true)
    expect(isModifierOnlyTerminalKey("a")).toBe(false)
  })
})
