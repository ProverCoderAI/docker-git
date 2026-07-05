import { describe, expect, it } from "@effect/vitest"
import { vi } from "vitest"

import {
  splitTerminalInlineImageOutput,
  type TerminalInlineImageOutputSegment,
  writeTerminalInlineImagePreviews,
  writeTerminalOutputSegment
} from "../../src/web/terminal-inline-images-core.js"
import type { TerminalInlineImageEntry } from "../../src/web/terminal-inline-images.js"
import {
  cachedTerminalInlineImageEntry,
  cacheTerminalInlineImageBlob,
  revokeTerminalInlineImageObjectUrlCache,
  terminalInlineImagePreviewRows,
  terminalInlineImageSpacer
} from "../../src/web/terminal-inline-images.js"

const issue250ImagePath = `/${["t", "mp"].join("")}/phantom-e2e.tuhl98/wallet-step-after-password.png`
const issue250DeleteCommand = `Ran rm -f ${issue250ImagePath}`
const issue250FileUrl = `file://${issue250ImagePath}`

describe("terminal inline image output", () => {
  it("keeps prompt output after a completed image path line in a later segment", () => {
    expect(splitTerminalInlineImageOutput("/var/data/a.png\r\nprompt> ")).toEqual([
      {
        endedWithLineBreak: true,
        imagePaths: ["/var/data/a.png"],
        text: "/var/data/a.png\r\n"
      },
      {
        endedWithLineBreak: false,
        imagePaths: [],
        text: "prompt> "
      }
    ])
  })

  it("marks incomplete image path lines so the renderer can add a line break first", () => {
    expect(splitTerminalInlineImageOutput("saved /var/data/a.png")).toEqual([
      {
        endedWithLineBreak: false,
        imagePaths: ["/var/data/a.png"],
        text: "saved /var/data/a.png"
      }
    ])
  })

  it("captures image paths from deletion command output", () => {
    expect(splitTerminalInlineImageOutput(issue250DeleteCommand)).toEqual([
      {
        endedWithLineBreak: false,
        imagePaths: [issue250ImagePath],
        text: issue250DeleteCommand
      }
    ])
  })

  it("captures file url image paths", () => {
    expect(splitTerminalInlineImageOutput(`saved ${issue250FileUrl}\r\n`)).toEqual([
      {
        endedWithLineBreak: true,
        imagePaths: [issue250FileUrl],
        text: `saved ${issue250FileUrl}\r\n`
      }
    ])
  })

  it("keeps inline image previews compact in the terminal output stream", () => {
    expect(terminalInlineImagePreviewRows).toBe(4)
    expect(terminalInlineImageSpacer).toBe("\r\n\r\n\r\n\r\n")
  })

  it("writes detected image paths as plain terminal text when automatic previews are disabled", () => {
    const textWrites: Array<string> = []
    const previewWrites: Array<TerminalInlineImageOutputSegment> = []
    const completions = { count: 0 }

    writeTerminalOutputSegment({
      inlineImagePreviewsEnabledRef: { current: false },
      segment: {
        endedWithLineBreak: false,
        imagePaths: [issue250ImagePath],
        text: issue250DeleteCommand
      },
      writer: {
        writePreviews: (segment, onComplete) => {
          previewWrites.push(segment)
          onComplete()
        },
        writeText: (text, onComplete) => {
          textWrites.push(text)
          onComplete()
        }
      }
    }, () => {
      completions.count += 1
    })

    expect(textWrites).toEqual([issue250DeleteCommand])
    expect(previewWrites).toEqual([])
    expect(completions.count).toBe(1)
  })

  it("forwards the segment to the preview writer after text when previews are enabled", () => {
    const writes: Array<string> = []
    const segment: TerminalInlineImageOutputSegment = {
      endedWithLineBreak: true,
      imagePaths: [issue250ImagePath],
      text: `${issue250ImagePath}\r\n`
    }

    writeTerminalOutputSegment({
      inlineImagePreviewsEnabledRef: { current: true },
      segment,
      writer: {
        writePreviews: (previewSegment, onComplete) => {
          writes.push(`previews:${previewSegment.imagePaths.join(",")}`)
          onComplete()
        },
        writeText: (text, onComplete) => {
          writes.push(`text:${text}`)
          onComplete()
        }
      }
    }, () => {
      writes.push("complete")
    })

    expect(writes).toEqual([
      `text:${issue250ImagePath}\r\n`,
      `previews:${issue250ImagePath}`,
      "complete"
    ])
  })

  it("caches successful image fetch blobs as reusable object urls", () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:terminal-image")
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => void 0)
    const cache = new Map<string, string>()
    const blob = new Blob(["image"], { type: "image/png" })
    const imagePath = "/var/data/example.png"
    const expectedEntry = {
      _tag: "AvailableTerminalInlineImage",
      displayUrl: "blob:terminal-image",
      fetchUrl: "https://api/image",
      path: imagePath
    }

    expect(cacheTerminalInlineImageBlob(cache, imagePath, "https://api/image", blob)).toEqual(expectedEntry)
    expect(cachedTerminalInlineImageEntry(cache, imagePath, "https://api/image")).toEqual(expectedEntry)
    expect(cacheTerminalInlineImageBlob(cache, imagePath, "https://api/image", blob)).toEqual(expectedEntry)
    expect(createObjectUrl).toHaveBeenCalledTimes(1)

    revokeTerminalInlineImageObjectUrlCache(cache)

    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:terminal-image")
    expect(cache.size).toBe(0)
  })

})

const availableEntry = (path: string): TerminalInlineImageEntry => ({
  _tag: "AvailableTerminalInlineImage",
  displayUrl: `blob:${path}`,
  fetchUrl: `https://api${path}`,
  path
})

type PreviewWriterLog = {
  readonly events: Array<string>
  readonly loadedEntries: Map<string, TerminalInlineImageEntry | null>
}

const previewWriter = ({ events, loadedEntries }: PreviewWriterLog) => ({
  loadEntry: (path: string, onComplete: (entry: TerminalInlineImageEntry | null) => void) => {
    events.push(`load:${path}`)
    onComplete(loadedEntries.get(path) ?? null)
  },
  renderPreview: (entry: TerminalInlineImageEntry, onComplete: () => void) => {
    events.push(`render:${entry.path}`)
    onComplete()
  },
  writeLineBreak: (onComplete: () => void) => {
    events.push("line-break")
    onComplete()
  }
})

describe("terminal inline image previews (issue 445)", () => {
  const missingPath = "/var/data/missing.png"
  const presentPath = "/var/data/present.png"

  it("does not render a preview for unavailable images", () => {
    const events: Array<string> = []
    const renderedPaths = new Set<string>()
    const completions = { count: 0 }

    writeTerminalInlineImagePreviews({
      needsLeadingLineBreak: true,
      paths: [missingPath],
      renderedPaths,
      writer: previewWriter({ events, loadedEntries: new Map([[missingPath, null]]) })
    }, () => {
      completions.count += 1
    })

    expect(events).toEqual([`load:${missingPath}`])
    expect(renderedPaths.size).toBe(0)
    expect(completions.count).toBe(1)
  })

  it("renders the same image path only once across segments", () => {
    const events: Array<string> = []
    const renderedPaths = new Set<string>()
    const loadedEntries = new Map([[presentPath, availableEntry(presentPath)]])

    writeTerminalInlineImagePreviews({
      needsLeadingLineBreak: false,
      paths: [presentPath],
      renderedPaths,
      writer: previewWriter({ events, loadedEntries })
    }, () => {
      events.push("complete:first")
    })
    writeTerminalInlineImagePreviews({
      needsLeadingLineBreak: false,
      paths: [presentPath],
      renderedPaths,
      writer: previewWriter({ events, loadedEntries })
    }, () => {
      events.push("complete:second")
    })

    expect(events).toEqual([
      `load:${presentPath}`,
      `render:${presentPath}`,
      "complete:first",
      "complete:second"
    ])
    expect(renderedPaths).toEqual(new Set([presentPath]))
  })

  it("writes the leading line break lazily and only before the first rendered preview", () => {
    const events: Array<string> = []
    const renderedPaths = new Set<string>()
    const otherPath = "/var/data/other.png"
    const loadedEntries = new Map<string, TerminalInlineImageEntry | null>([
      [missingPath, null],
      [otherPath, availableEntry(otherPath)],
      [presentPath, availableEntry(presentPath)]
    ])

    writeTerminalInlineImagePreviews({
      needsLeadingLineBreak: true,
      paths: [missingPath, presentPath, otherPath],
      renderedPaths,
      writer: previewWriter({ events, loadedEntries })
    }, () => {
      events.push("complete")
    })

    expect(events).toEqual([
      `load:${missingPath}`,
      `load:${presentPath}`,
      "line-break",
      `render:${presentPath}`,
      `load:${otherPath}`,
      `render:${otherPath}`,
      "complete"
    ])
  })

  it("leaves output untouched when every preview is skipped", () => {
    const events: Array<string> = []
    const renderedPaths = new Set([presentPath])

    writeTerminalInlineImagePreviews({
      needsLeadingLineBreak: true,
      paths: [presentPath],
      renderedPaths,
      writer: previewWriter({ events, loadedEntries: new Map() })
    }, () => {
      events.push("complete")
    })

    expect(events).toEqual(["complete"])
  })
})
