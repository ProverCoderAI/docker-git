import { describe, expect, it } from "@effect/vitest"

import { expectCreateCommand, expectParseErrorTag } from "./parser-helpers.js"

describe("parseArgs playwright resource limits", () => {
  it.effect("parses dedicated playwright resource limit flags", () =>
    expectCreateCommand(
      [
        "create",
        "--repo-url",
        "https://github.com/org/repo.git",
        "--playwright-cpu",
        "0.5",
        "--playwright-ram",
        "1g"
      ],
      (command) => {
        expect(command.config.playwrightCpuLimit).toBe("0.5")
        expect(command.config.playwrightRamLimit).toBe("1g")
      }
    ))

  it.effect("falls back playwright limits to main limits when not specified", () =>
    expectCreateCommand(
      ["create", "--repo-url", "https://github.com/org/repo.git", "--cpu", "1.5", "--ram", "2g"],
      (command) => {
        expect(command.config.cpuLimit).toBe("1.5")
        expect(command.config.ramLimit).toBe("2g")
        expect(command.config.playwrightCpuLimit).toBe("1.5")
        expect(command.config.playwrightRamLimit).toBe("2g")
      }
    ))

  it.effect("accepts compose-style aliases for playwright limits", () =>
    expectCreateCommand(
      [
        "create",
        "--repo-url",
        "https://github.com/org/repo.git",
        "--playwright-cpus",
        "0.75",
        "--playwright-memory",
        "1500m"
      ],
      (command) => {
        expect(command.config.playwrightCpuLimit).toBe("0.75")
        expect(command.config.playwrightRamLimit).toBe("1500m")
      }
    ))

  it.effect("rejects invalid playwright RAM limit", () =>
    expectParseErrorTag(
      ["create", "--repo-url", "https://github.com/org/repo.git", "--playwright-ram", "not-a-size"],
      "InvalidOption"
    ))
})
