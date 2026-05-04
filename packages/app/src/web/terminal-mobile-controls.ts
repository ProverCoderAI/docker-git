export type MobileTerminalKey = "escape" | "left" | "right" | "tab" | "up" | "down" | "ctrl-c"

const mobileTerminalKeyInputs: Record<MobileTerminalKey, string> = {
  escape: "\u001b",
  left: "\u001b[D",
  right: "\u001b[C",
  tab: "\t",
  up: "\u001b[A",
  down: "\u001b[B",
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

export const terminalControlCharacterForKey = (key: string): string | null => {
  if (key.length === 1 && key >= "a" && key <= "z") {
    return String.fromCharCode(key.charCodeAt(0) - 96)
  }
  if (key.length === 1 && key >= "A" && key <= "Z") {
    return String.fromCharCode(key.charCodeAt(0) - 64)
  }

  if (key === "@") {
    return "\u0000"
  }
  if (key === "[") {
    return "\u001b"
  }
  if (key === "\\") {
    return "\u001c"
  }
  if (key === "]") {
    return "\u001d"
  }
  if (key === "^") {
    return "\u001e"
  }
  if (key === "_") {
    return "\u001f"
  }
  return null
}
