export type MobileTerminalKey = "escape" | "left" | "right" | "tab" | "up" | "down" | "ctrl-c"

const mobileTerminalKeyInputs: Record<MobileTerminalKey, string> = {
  escape: "\u{1B}",
  left: "\u{1B}[D",
  right: "\u{1B}[C",
  tab: "\t",
  up: "\u{1B}[A",
  down: "\u{1B}[B",
  "ctrl-c": "\u{3}"
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
  "@": "\u{0}",
  "[": "\u{1B}",
  "\\": "\u{1C}",
  "]": "\u{1D}",
  "^": "\u{1E}",
  _: "\u{1F}"
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
