export type TerminalOutputBuffer = {
  readonly charLength: number
  readonly chunks: ReadonlyArray<string>
}

export const terminalOutputReplayMaxChars = 2 * 1024 * 1024

export const emptyTerminalOutputBuffer: TerminalOutputBuffer = {
  charLength: 0,
  chunks: []
}

const boundedMaxChars = (maxChars: number): number =>
  Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0

const trimTerminalOutputChunks = (
  chunks: ReadonlyArray<string>,
  overflow: number
): ReadonlyArray<string> => {
  const kept: Array<string> = []
  let remainingOverflow = overflow
  for (const chunk of chunks) {
    if (remainingOverflow <= 0) {
      kept.push(chunk)
      continue
    }
    if (chunk.length <= remainingOverflow) {
      remainingOverflow -= chunk.length
      continue
    }
    kept.push(chunk.slice(remainingOverflow))
    remainingOverflow = 0
  }
  return kept
}

export const appendTerminalOutput = (
  buffer: TerminalOutputBuffer,
  data: string,
  maxChars = terminalOutputReplayMaxChars
): TerminalOutputBuffer => {
  const boundedMax = boundedMaxChars(maxChars)
  if (boundedMax === 0) {
    return emptyTerminalOutputBuffer
  }
  if (data.length === 0) {
    return buffer
  }
  if (data.length >= boundedMax) {
    return {
      charLength: boundedMax,
      chunks: [data.slice(data.length - boundedMax)]
    }
  }
  const charLength = buffer.charLength + data.length
  const chunks = [...buffer.chunks, data]
  if (charLength <= boundedMax) {
    return { charLength, chunks }
  }
  const overflow = charLength - boundedMax
  return {
    charLength: boundedMax,
    chunks: trimTerminalOutputChunks(chunks, overflow)
  }
}

export const renderTerminalOutputBuffer = (buffer: TerminalOutputBuffer): string =>
  buffer.chunks.join("")
