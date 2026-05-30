import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import {
  createTerminalImagePastePlan,
  sanitizeTerminalImageBaseName,
  terminalImagePasteDirectory
} from "../../src/core/index.js"

describe("terminal image paste planning", () => {
  it.effect("builds a valid paste plan for supported image payloads", () =>
    Effect.sync(() => {
      const plan = createTerminalImagePastePlan(
        { data: "aGVsbG8=", mediaType: "image/png", name: "../hello world.png", size: 5 },
        "paste-1"
      )

      expect(plan).toEqual({
        _tag: "ValidTerminalImagePaste",
        containerPath: `${terminalImagePasteDirectory}/paste-1-hello-world.png`,
        decodedBytes: 5,
        normalizedBase64: "aGVsbG8="
      })
    }))

  it.effect("sanitizes unsafe image names", () =>
    Effect.sync(() => {
      expect(sanitizeTerminalImageBaseName("../..//.bad name!!.png")).toBe("bad-name")
      expect(sanitizeTerminalImageBaseName("////.png")).toBe("clipboard-image")
    }))

  it.effect("sanitizes arbitrary image names into non-traversal path segments", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(fc.string({ maxLength: 256 }), (name) => {
          const sanitized = sanitizeTerminalImageBaseName(name)

          expect(sanitized.length).toBeGreaterThan(0)
          expect(sanitized.length).toBeLessThanOrEqual(72)
          expect(sanitized).not.toContain("/")
          expect(sanitized).not.toContain("\\")
          expect(sanitized).not.toContain("..")
        }),
        { numRuns: 100 }
      )
    }))

  it.effect("keeps arbitrary paste ids and names inside the paste directory", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 128 }),
          fc.string({ maxLength: 128 }),
          (id, name) => {
            const plan = createTerminalImagePastePlan(
              { data: "AA==", mediaType: "image/png", name, size: 1 },
              id
            )

            expect(plan._tag).toBe("ValidTerminalImagePaste")
            if (plan._tag === "ValidTerminalImagePaste") {
              const prefix = `${terminalImagePasteDirectory}/`
              const relativePath = plan.containerPath.slice(prefix.length)

              expect(plan.containerPath.startsWith(prefix)).toBe(true)
              expect(relativePath).not.toContain("/")
              expect(relativePath).not.toContain("\\")
              expect(relativePath).not.toContain("..")
            }
          }
        ),
        { numRuns: 100 }
      )
    }))

  it.effect("rejects invalid base64 payloads", () =>
    Effect.sync(() => {
      const plan = createTerminalImagePastePlan(
        { data: "not base64", mediaType: "image/png", name: "bad.png", size: 10 },
        "paste-1"
      )

      expect(plan).toEqual({
        _tag: "InvalidTerminalImagePaste",
        message: "Image payload is not valid base64."
      })
    }))
})
