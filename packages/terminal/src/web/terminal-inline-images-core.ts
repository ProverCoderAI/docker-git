import { detectTerminalImagePaths } from "./terminal-image-paths.js"
import type { TerminalInlineImageEntry } from "./terminal-inline-images.js"

export type TerminalInlineImageOutputSegment = {
  readonly endedWithLineBreak: boolean
  readonly imagePaths: ReadonlyArray<string>
  readonly text: string
}

export type TerminalInlineImagePreviewsEnabledRef = { readonly current: boolean }

export type TerminalOutputSegmentWriter = {
  readonly writePreviews: (segment: TerminalInlineImageOutputSegment, onComplete: () => void) => void
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
 * @effect writer callbacks: writeText, writePreviews.
 * @precondition segment is the next queued terminal output segment and
 * onComplete belongs to the caller's active output queue drain.
 * @postcondition writeText is requested exactly once; when previews are enabled
 * and imagePaths is non-empty, the preview write is requested before onComplete.
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
    writer.writePreviews(segment, onComplete)
  })
}

export type TerminalInlineImagePreviewWriter = {
  readonly loadEntry: (path: string, onComplete: (entry: TerminalInlineImageEntry | null) => void) => void
  readonly renderPreview: (entry: TerminalInlineImageEntry, onComplete: () => void) => void
  readonly writeLineBreak: (onComplete: () => void) => void
}

export type TerminalInlineImagePreviewWriteArgs = {
  readonly needsLeadingLineBreak: boolean
  readonly paths: ReadonlyArray<string>
  readonly renderedPaths: Set<string>
  readonly writer: TerminalInlineImagePreviewWriter
}

/**
 * Sequences inline image preview writes for the image paths of one segment.
 *
 * Skips paths whose preview was already rendered in this terminal session and
 * paths whose entry loads as `null` (unavailable image), so unavailable links
 * never produce a placeholder and the same image is rendered at most once.
 * The leading line break is written lazily before the first rendered preview
 * only, so segments whose previews are all skipped leave the output untouched.
 *
 * @param args - Preview paths, session-rendered path set, and effectful writer callbacks.
 * @param onComplete - Invoked exactly once after every path is processed.
 * @returns Nothing; results are delivered through the writer callbacks.
 * @pure false - invokes effectful writer callbacks and mutates renderedPaths.
 * @effect writer callbacks: loadEntry, renderPreview, writeLineBreak.
 * @precondition paths contains no duplicates (segment paths are deduplicated at detection).
 * @postcondition ∀ path ∈ paths: rendered(path) → path ∈ renderedPaths, and
 * renderPreview runs only for freshly loaded, previously unrendered entries.
 * @invariant renderPreview is never invoked for a null entry or a path already
 * in renderedPaths; writeLineBreak runs at most once and only before the first render.
 * @complexity O(n) where n = |paths|.
 * @throws Through writer callbacks or onComplete only.
 */
// CHANGE: skip unavailable inline images and deduplicate previews per terminal session
// WHY: rendering placeholders for unresolvable paths and repeating previews for the
//      same image adds noise to terminal output without conveying information
// QUOTE(ТЗ): "не пытаться рендерить unavailable ссылки + сделать что бы одна и таже
//      картинка не рендерилась несколько раз"
// REF: issue-445
// SOURCE: n/a
// FORMAT THEOREM: ∀ path: renders(path) ≤ 1 ∧ (entry(path) = null → renders(path) = 0)
// PURITY: CORE sequencing over injected SHELL callbacks
// EFFECT: mutates renderedPaths and drives writer callbacks
// INVARIANT: onComplete fires exactly once after all paths are processed in input order
// COMPLEXITY: O(n) where n = |paths|
export const writeTerminalInlineImagePreviews = (
  { needsLeadingLineBreak, paths, renderedPaths, writer }: TerminalInlineImagePreviewWriteArgs,
  onComplete: () => void
): void => {
  let lineBreakPending = needsLeadingLineBreak
  let index = 0
  const renderNext = (entry: TerminalInlineImageEntry, onRendered: () => void): void => {
    if (!lineBreakPending) {
      writer.renderPreview(entry, onRendered)
      return
    }
    lineBreakPending = false
    writer.writeLineBreak(() => {
      writer.renderPreview(entry, onRendered)
    })
  }
  const writeNext = (): void => {
    const path = paths[index]
    if (path === undefined) {
      onComplete()
      return
    }
    index += 1
    if (renderedPaths.has(path)) {
      writeNext()
      return
    }
    writer.loadEntry(path, (entry) => {
      if (entry === null) {
        writeNext()
        return
      }
      renderedPaths.add(path)
      renderNext(entry, writeNext)
    })
  }
  writeNext()
}
