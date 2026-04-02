import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { expectParseErrorTag, parseOrThrow } from "./parser-helpers.js"

describe("parse scrap commands", () => {
  it.effect("parses scrap export with defaults", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["scrap", "export"])
      if (command._tag !== "ScrapExport") {
        throw new Error("expected ScrapExport command")
      }
      expect(command.projectDir).toBe(".")
      expect(command.archivePath).toBe(".orch/scrap/session")
    }))

  it.effect("fails scrap import without archive", () =>
    expectParseErrorTag(["scrap", "import"], "MissingRequiredOption"))

  it.effect("parses scrap import wipe defaults", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["scrap", "import", "--archive", "workspace.tar.gz"])
      if (command._tag !== "ScrapImport") {
        throw new Error("expected ScrapImport command")
      }
      expect(command.wipe).toBe(true)
    }))

  it.effect("parses scrap import --no-wipe", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["scrap", "import", "--archive", "workspace.tar.gz", "--no-wipe"])
      if (command._tag !== "ScrapImport") {
        throw new Error("expected ScrapImport command")
      }
      expect(command.wipe).toBe(false)
    }))
})
