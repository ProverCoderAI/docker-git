import { describe, expect, it } from "@effect/vitest"
import * as fc from "fast-check"

import {
  applyFilePatch,
  parsePatch,
  splitText
} from "../../../../scripts/skiller-apply-docker-git-patches.mjs"

const patchText = [
  "diff --git a/file.txt b/file.txt",
  "--- a/file.txt",
  "+++ b/file.txt",
  "@@ -1,2 +1,2 @@",
  " alpha",
  "-old",
  "+new",
  ""
].join("\n")

const lineTextArbitrary = fc.string({ maxLength: 32 }).filter((line) =>
  !line.includes("\n") && !line.includes("\r")
)

const crlfTextPartsArbitrary = fc
  .tuple(
    fc.array(lineTextArbitrary, { minLength: 1, maxLength: 8 }),
    fc.boolean()
  )
  .map(([lines, finalNewline]) => ({
    finalNewline,
    lines,
    text: `${lines.join("\r\n")}${finalNewline ? "\r\n" : ""}`
  }))

const parsedFilePatch = () => {
  const filePatch = parsePatch(patchText)[0]
  if (filePatch === undefined) {
    throw new Error("expected parsed file patch")
  }
  return filePatch
}

describe("skiller patch helpers", () => {
  it("normalizes CRLF content before exact hunk matching", () => {
    const filePatch = parsedFilePatch()
    expect(applyFilePatch("alpha\r\nold\r\n", filePatch, "forward")).toBe("alpha\nnew\n")
  })

  it("preserves final newline after CRLF normalization", () => {
    expect(splitText("alpha\r\n")).toEqual({
      finalNewline: true,
      lines: ["alpha"]
    })
  })

  it("normalizes generated CRLF line sets without leaking carriage returns", () => {
    fc.assert(
      fc.property(crlfTextPartsArbitrary, ({ text }) => {
        const result = splitText(text)
        const reconstructed = `${result.lines.join("\n")}${result.finalNewline ? "\n" : ""}`

        expect(result.finalNewline).toBe(text.endsWith("\n"))
        expect(reconstructed).toBe(text.replaceAll("\r\n", "\n"))
        expect(result.lines.every((line) => !line.includes("\r"))).toBe(true)
      })
    )
  })

  it("applies generated CRLF patch inputs the same as pre-normalized LF inputs", () => {
    const filePatch = parsedFilePatch()

    fc.assert(
      fc.property(
        fc.array(lineTextArbitrary, { minLength: 0, maxLength: 8 }),
        fc.boolean(),
        (tailLines, finalNewline) => {
          const sourceLines = ["alpha", "old", ...tailLines]
          const crlfInput = `${sourceLines.join("\r\n")}${finalNewline ? "\r\n" : ""}`
          const lfInput = crlfInput.replaceAll("\r\n", "\n")

          expect(applyFilePatch(crlfInput, filePatch, "forward")).toBe(
            applyFilePatch(lfInput, filePatch, "forward")
          )
        }
      )
    )
  })
})
