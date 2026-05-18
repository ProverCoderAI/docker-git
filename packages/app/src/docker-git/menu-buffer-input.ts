export type BufferInputKey = {
  readonly backspace?: boolean
  readonly delete?: boolean
}

export const nextBufferValue = (
  input: string,
  key: BufferInputKey,
  buffer: string
): string | null => {
  if (key.backspace || key.delete) {
    return buffer.slice(0, -1)
  }
  if (input.length > 0) {
    return buffer + input
  }
  return null
}
