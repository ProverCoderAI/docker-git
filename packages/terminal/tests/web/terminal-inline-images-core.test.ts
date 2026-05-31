import { describe, expect, it } from "@effect/vitest"
import { vi } from "vitest"

import {
  splitTerminalInlineImageOutput,
  writeTerminalOutputSegment
} from "../../src/web/terminal-inline-images-core.js"
import {
  cachedTerminalInlineImageEntry,
  cacheTerminalInlineImageBlob,
  revokeTerminalInlineImageObjectUrlCache,
  terminalInlineImagePreviewRows,
  terminalInlineImageSpacer,
  unavailableTerminalInlineImageEntry
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
    const previewWrites: Array<ReadonlyArray<string>> = []
    const previewLineBreaks = { count: 0 }
    const completions = { count: 0 }

    writeTerminalOutputSegment({
      inlineImagePreviewsEnabledRef: { current: false },
      segment: {
        endedWithLineBreak: false,
        imagePaths: [issue250ImagePath],
        text: issue250DeleteCommand
      },
      writer: {
        writePreviewLineBreak: (_segment, onComplete) => {
          previewLineBreaks.count += 1
          onComplete()
        },
        writePreviews: (paths, onComplete) => {
          previewWrites.push(paths)
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
    expect(previewLineBreaks.count).toBe(0)
    expect(previewWrites).toEqual([])
    expect(completions.count).toBe(1)
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

  it("represents failed image fetches without using a broken image url", () => {
    expect(unavailableTerminalInlineImageEntry("/var/data/missing.png", "https://api/image")).toEqual({
      _tag: "UnavailableTerminalInlineImage",
      fetchUrl: "https://api/image",
      path: "/var/data/missing.png"
    })
  })
})
