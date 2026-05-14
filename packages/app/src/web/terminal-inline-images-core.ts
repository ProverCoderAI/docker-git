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

const endsWithLineBreak = (text: string): boolean => /\r\n$|\r$|\n$/u.test(text)

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
      endedWithLineBreak: endsWithLineBreak(text),
      imagePaths: detectTerminalImagePaths(text),
      text
    })
  }
  return segments
}

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
