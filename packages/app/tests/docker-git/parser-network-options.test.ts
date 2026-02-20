import { describe, expect, it } from "@effect/vitest"
import { Effect, Either } from "effect"

import { parseArgs } from "../../src/docker-git/cli/parser.js"

describe("parseArgs network options", () => {
  it.effect("parses create network mode options", () =>
    Effect.sync(() => {
      const parsed = parseArgs([
        "create",
        "--repo-url",
        "https://github.com/org/repo.git",
        "--network-mode",
        "project",
        "--shared-network",
        "ignored-shared-network"
      ])
      if (Either.isLeft(parsed)) {
        throw new Error(`unexpected parse error: ${parsed.left._tag}`)
      }
      const command = parsed.right
      if (command._tag !== "Create") {
        throw new Error("expected Create command")
      }
      expect(command.config.dockerNetworkMode).toBe("project")
      expect(command.config.dockerSharedNetworkName).toBe("ignored-shared-network")
    }))

  it.effect("fails on invalid network mode", () =>
    Effect.sync(() => {
      const command = parseArgs([
        "create",
        "--repo-url",
        "https://github.com/org/repo.git",
        "--network-mode",
        "invalid"
      ])
      Either.match(command, {
        onLeft: (error) => {
          expect(error._tag).toBe("InvalidOption")
        },
        onRight: () => {
          throw new Error("expected parse error")
        }
      })
    }))
})
