import { detectTerminalImagePaths } from "./terminal-image-paths.js"

export type TerminalInlineImageOutputSegment = {
  readonly endedWithLineBreak: boolean
  readonly imagePaths: ReadonlyArray<string>
  readonly text: string
}

export type TerminalInlineImagePreviewsEnabledRef = { readonly current: boolean }

export type TerminalOutputSegmentWriter = {
  readonly writePreviewLineBreak: (segment: TerminalInlineImageOutputSegment, onComplete: () => void) => void
  readonly writePreviews: (paths: ReadonlyArray<string>, onComplete: () => void) => void
  readonly writeText: (text: string, onComplete: () => void) => void
}

export type TerminalOutputSegmentWriteArgs = {
  readonly inlineImagePreviewsEnabledRef: TerminalInlineImagePreviewsEnabledRef
  readonly segment: TerminalInlineImageOutputSegment
  readonly writer: TerminalOutputSegmentWriter
}

const lineBreakPattern = /\r\n|\r|\n/gu

const hasTrailingLineBreak = (text: string): boolean => /\r\n$|\r$|\n$/u.test(text)

export const splitTerminalInlineImageOutput = (
  data: string
): ReadonlyArray<TerminalInlineImageOutputSegment> => {
  if (data.length === 0) {
    return []
  }
  const segments: Array<TerminalInlineImageOutputSegment> = []
  let startIndex = 0
  for (const match of data.matchAll(lineBreakPattern)) {
    const endIndex = match.index + match[0].length
    const text = data.slice(startIndex, endIndex)
    segments.push({
      endedWithLineBreak: true,
      imagePaths: detectTerminalImagePaths(text),
      text
    })
    startIndex = endIndex
  }
  if (startIndex < data.length) {
    const text = data.slice(startIndex)
    segments.push({
      endedWithLineBreak: hasTrailingLineBreak(text),
      imagePaths: detectTerminalImagePaths(text),
      text
    })
  }
  return segments
}

/**
 * Coordinates terminal output writes for one parsed segment.
 *
 * This function only sequences the supplied writer callbacks. It does not fetch
 * image data, allocate decorations, or mutate terminal state directly; those
 * effects belong to the writer implementation.
 *
 * @pure false - invokes effectful writer callbacks.
 * @effect writer callbacks: writeText, writePreviewLineBreak, writePreviews.
 * @precondition segment is the next queued terminal output segment and
 * onComplete belongs to the caller's active output queue drain.
 * @postcondition writeText is requested exactly once; when previews are enabled
 * and imagePaths is non-empty, the preview line break and preview writes are
 * requested in order before onComplete.
 * @invariant segment.text is emitted before any preview callback, and preview
 * callbacks never run when imagePaths is empty or previews are disabled.
 * @complexity O(1) plus writer callback complexity; image paths are forwarded
 * without iteration.
 * @throws Through writer callbacks or onComplete only; this function has no
 * explicit throw path.
 */
export const writeTerminalOutputSegment = (
  { inlineImagePreviewsEnabledRef, segment, writer }: TerminalOutputSegmentWriteArgs,
  onComplete: () => void
): void => {
  writer.writeText(segment.text, () => {
    if (segment.imagePaths.length === 0 || !inlineImagePreviewsEnabledRef.current) {
      onComplete()
      return
    }
    writer.writePreviewLineBreak(segment, () => {
      writer.writePreviews(segment.imagePaths, onComplete)
    })
  })
}
