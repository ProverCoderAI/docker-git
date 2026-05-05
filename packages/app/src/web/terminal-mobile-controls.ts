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

export const mobileTerminalKeyInput = (key: MobileTerminalKey): string => mobileTerminalKeyInputs[key]

export const isModifierOnlyTerminalKey = (key: string): boolean => modifierOnlyKeys.has(key)

const controlCharacterFromKey = (key: string, offset: number): string | null => {
  const codePoint = key.codePointAt(0)
  return codePoint === undefined ? null : String.fromCodePoint(codePoint - offset)
}

export const terminalControlCharacterForKey = (key: string): string | null => {
  if (key.length === 1 && key >= "a" && key <= "z") {
    return controlCharacterFromKey(key, 96)
  }
  if (key.length === 1 && key >= "A" && key <= "Z") {
    return controlCharacterFromKey(key, 64)
  }

  if (key === "@") {
    return "\u0000"
  }
  if (key === "[") {
    return "\u001B"
  }
  if (key === "\\") {
    return "\u001C"
  }
  if (key === "]") {
    return "\u001D"
  }
  if (key === "^") {
    return "\u001E"
  }
  if (key === "_") {
    return "\u001F"
  }
  return null
}
