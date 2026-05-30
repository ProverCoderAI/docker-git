import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import { planTerminalImageFetch } from "../../src/server/index.js"

const expectedMediaTypes = new Map<string, string>([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"]
])

const safePathName = fc
  .array(fc.constantFrom("a", "b", "c", "d", "e", "f", "0", "1", "2", "-", "_"), {
    maxLength: 32,
    minLength: 1
  })
  .map((chars) => chars.join(""))

describe("terminal image fetch planning", () => {
  it.effect("accepts absolute supported image paths", () =>
    Effect.sync(() => {
      expect(planTerminalImageFetch("/home/dev/image.png")).toEqual({
        _tag: "ValidTerminalImageFetch",
        containerPath: "/home/dev/image.png",
        mediaType: "image/png"
      })
    }))

  it.effect("joins relative paths to a valid base directory", () =>
    Effect.sync(() => {
      expect(planTerminalImageFetch("screens/shot.webp", { baseDir: "/home/dev/project" })).toEqual({
        _tag: "ValidTerminalImageFetch",
        containerPath: "/home/dev/project/screens/shot.webp",
        mediaType: "image/webp"
      })
    }))

  it.effect("rejects traversal paths", () =>
    Effect.sync(() => {
      expect(planTerminalImageFetch("/home/dev/../secret.png")).toEqual({
        _tag: "InvalidTerminalImageFetch",
        message: "Image path must not contain '.' or '..' segments."
      })
    }))

  it.effect("maps supported extensions to deterministic media types", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          fc.constantFrom("gif", "jpeg", "jpg", "png", "webp"),
          safePathName,
          (extension, name) => {
            const plan = planTerminalImageFetch(`/home/dev/${name}.${extension}`)

            expect(plan).toEqual({
              _tag: "ValidTerminalImageFetch",
              containerPath: `/home/dev/${name}.${extension}`,
              mediaType: expectedMediaTypes.get(extension)
            })
          }
        ),
        { numRuns: 100 }
      )
    }))

  it.effect("rejects arbitrary paths containing traversal segments", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          fc.constantFrom(".", ".."),
          fc.constantFrom("png", "jpg", "webp"),
          (segment, extension) => {
            const plan = planTerminalImageFetch(`/home/dev/${segment}/image.${extension}`)

            expect(plan).toEqual({
              _tag: "InvalidTerminalImageFetch",
              message: "Image path must not contain '.' or '..' segments."
            })
          }
        ),
        { numRuns: 50 }
      )
    }))
})
