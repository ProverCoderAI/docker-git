import { describe, expect, it } from "@effect/vitest"

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

describe("skiller patch helpers", () => {
  it("normalizes CRLF content before exact hunk matching", () => {
    const patches = parsePatch(patchText)
    const filePatch = patches[0]
    if (filePatch === undefined) {
      throw new Error("expected parsed file patch")
    }

    expect(applyFilePatch("alpha\r\nold\r\n", filePatch, "forward")).toBe("alpha\nnew\n")
  })

  it("preserves final newline after CRLF normalization", () => {
    expect(splitText("alpha\r\n")).toEqual({
      finalNewline: true,
      lines: ["alpha"]
    })
  })
})
