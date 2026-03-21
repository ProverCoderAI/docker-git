// CHANGE: extract ANSI escape sequence stripping to shared module
// WHY: avoid code duplication between auth-claude-oauth.ts and auth-gemini-oauth.ts
// REF: issue-146, lint error
// PURITY: CORE
// COMPLEXITY: O(n) where n = string length

const ansiEscape = "\u001B"
const ansiBell = "\u0007"

const isAnsiFinalByte = (codePoint: number | undefined): boolean =>
  codePoint !== undefined && codePoint >= 0x40 && codePoint <= 0x7E

const skipCsiSequence = (raw: string, start: number): number => {
  const length = raw.length
  let index = start + 2
  while (index < length) {
    const codePoint = raw.codePointAt(index)
    if (isAnsiFinalByte(codePoint)) {
      return index + 1
    }
    index += 1
  }
  return index
}

const skipOscSequence = (raw: string, start: number): number => {
  const length = raw.length
  let index = start + 2
  while (index < length) {
    const char = raw[index] ?? ""
    if (char === ansiBell) {
      return index + 1
    }
    if (char === ansiEscape && raw[index + 1] === "\\") {
      return index + 2
    }
    index += 1
  }
  return index
}

const skipEscapeSequence = (raw: string, start: number): number => {
  const next = raw[start + 1] ?? ""
  if (next === "[") {
    return skipCsiSequence(raw, start)
  }
  if (next === "]") {
    return skipOscSequence(raw, start)
  }
  return Math.min(raw.length, start + 2)
}

export const stripAnsi = (raw: string): string => {
  const cleaned: Array<string> = []
  let index = 0

  while (index < raw.length) {
    const current = raw[index] ?? ""
    if (current !== ansiEscape) {
      cleaned.push(current)
      index += 1
      continue
    }
    index = skipEscapeSequence(raw, index)
  }

  return cleaned.join("")
}

// CHANGE: extract writeChunkToFd to shared module
// WHY: avoid code duplication between auth-claude-oauth.ts and auth-gemini-oauth.ts
// REF: issue-146, lint error
// PURITY: SHELL (I/O side effect)
// COMPLEXITY: O(1)
export const writeChunkToFd = (fd: number, chunk: Uint8Array): void => {
  if (fd === 2) {
    process.stderr.write(chunk)
    return
  }
  process.stdout.write(chunk)
}
