export type MobileTerminalKey = "escape" | "left" | "right" | "tab" | "up" | "down" | "ctrl-c"

const mobileTerminalKeyInputs: Record<MobileTerminalKey, string> = {
  escape: "\u001B",
  left: "\u001B[D",
  right: "\u001B[C",
  tab: "\t",
  up: "\u001B[A",
  down: "\u001B[B",
  "ctrl-c": "\u0003"
}

const modifierOnlyKeys = new Set([
  "Alt",
  "CapsLock",
  "Control",
  "Fn",
  "Meta",
  "NumLock",
  "ScrollLock",
  "Shift"
])

const terminalControlSymbolInputs: Readonly<Record<string, string>> = {
  "@": "\u0000",
  "[": "\u001B",
  "\\": "\u001C",
  "]": "\u001D",
  "^": "\u001E",
  _: "\u001F"
}

export const mobileTerminalKeyInput = (key: MobileTerminalKey): string => mobileTerminalKeyInputs[key]

export const isModifierOnlyTerminalKey = (key: string): boolean => modifierOnlyKeys.has(key)

const controlCharacterFromRange = (
  key: string,
  first: string,
  last: string,
  offset: number
): string | null => {
  if (key.length !== 1 || key < first || key > last) {
    return null
  }
  return String.fromCodePoint((key.codePointAt(0) ?? 0) - offset)
}

export const terminalControlCharacterForKey = (key: string): string | null => {
  const lower = controlCharacterFromRange(key, "a", "z", 96)
  if (lower !== null) {
    return lower
  }
  return controlCharacterFromRange(key, "A", "Z", 64) ?? terminalControlSymbolInputs[key] ?? null
}
