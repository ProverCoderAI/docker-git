export type TerminalOutputBuffer = {
  readonly charLength: number
  readonly chunks: ReadonlyArray<string>
}

/**
 * Maximum replay size retained for terminal reconnects.
 *
 * @pure true
 * @invariant terminalOutputReplayMaxChars > 0
 * @complexity O(1)
 */
// CHANGE: expose the terminal replay budget as a shared core constant.
// WHY: API and clients need one bounded replay invariant.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: terminalOutputReplayMaxChars = 2 MiB
// PURITY: CORE
// INVARIANT: replay budget is positive and deterministic.
// COMPLEXITY: O(1)/O(1)
export const terminalOutputReplayMaxChars = 2 * 1024 * 1024

/**
 * Empty terminal output replay buffer.
 *
 * @pure true
 * @invariant charLength = 0 ∧ chunks = []
 * @complexity O(1)
 */
export const emptyTerminalOutputBuffer: TerminalOutputBuffer = {
  charLength: 0,
  chunks: []
}

const boundedMaxChars = (maxChars: number): number => Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0

type TrimTerminalOutputState = {
  readonly startIndex: number
  readonly startOffset: number
}

const trimTerminalOutputState = (
  chunks: ReadonlyArray<string>,
  overflow: number,
  index: number
): TrimTerminalOutputState => {
  const chunk = chunks[index]
  if (chunk === undefined || overflow <= 0) {
    return { startIndex: index, startOffset: 0 }
  }
  if (chunk.length <= overflow) {
    return trimTerminalOutputState(chunks, overflow - chunk.length, index + 1)
  }
  return { startIndex: index, startOffset: overflow }
}

const trimTerminalOutputChunks = (
  chunks: ReadonlyArray<string>,
  overflow: number
): ReadonlyArray<string> => {
  const trimState = trimTerminalOutputState(chunks, overflow, 0)
  return chunks.slice(trimState.startIndex).map((chunk, index) =>
    index === 0 ? chunk.slice(trimState.startOffset) : chunk
  )
}

/**
 * Appends terminal output while keeping only the newest bounded suffix.
 *
 * @pure true
 * @param buffer - Existing immutable replay buffer.
 * @param data - New terminal output chunk.
 * @param maxChars - Maximum rendered replay length after append.
 * @returns New immutable replay buffer.
 * @invariant 0 <= result.charLength <= floor(maxChars)
 * @invariant render(result) is a suffix of render(buffer) + data
 * @precondition buffer.charLength = render(buffer).length
 * @postcondition result.charLength = render(result).length
 * @complexity O(n + m) where n = chunks count and m = copied suffix length
 */
// CHANGE: keep terminal replay buffering as pure immutable core logic.
// WHY: reconnect replay must be deterministic and bounded.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: ∀b,d,k: len(render(append(b,d,k))) <= max(0, floor(k))
// PURITY: CORE
// INVARIANT: output replay is always the newest bounded suffix.
// COMPLEXITY: O(n + m)/O(n + m)
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

/**
 * Renders a terminal replay buffer into one output string.
 *
 * @pure true
 * @param buffer - Immutable replay buffer.
 * @returns Concatenated terminal output chunks.
 * @invariant result.length = buffer.charLength for buffers produced by appendTerminalOutput
 * @precondition buffer.chunks contains terminal output chunks in chronological order.
 * @postcondition input buffer is not mutated.
 * @complexity O(n) where n = total rendered character count.
 */
// CHANGE: expose a pure renderer for terminal replay buffers.
// WHY: adapters should not inspect chunk internals.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: render({chunks}) = concat(chunks)
// PURITY: CORE
// INVARIANT: render preserves chunk order.
// COMPLEXITY: O(n)/O(n)
export const renderTerminalOutputBuffer = (
  buffer: TerminalOutputBuffer
): string => buffer.chunks.join("")
