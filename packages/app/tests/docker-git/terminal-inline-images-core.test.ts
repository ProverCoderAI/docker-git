import { describe, expect, it } from "@effect/vitest"

import { splitTerminalInlineImageOutput } from "../../src/web/terminal-inline-images-core.js"

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
})
