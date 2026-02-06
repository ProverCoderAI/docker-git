import { describe, expect, it } from "@effect/vitest"
import { Effect, Either } from "effect"

import { type Command, defaultTemplateConfig } from "@effect-template/lib/core/domain"
import { parseArgs } from "../../src/docker-git/cli/parser.js"

type CreateCommand = Extract<Command, { _tag: "Create" }>

const expectCreateCommand = (
  args: ReadonlyArray<string>,
  onRight: (command: CreateCommand) => void
) =>
  Effect.sync(() => {
    Either.match(parseArgs(args), {
      onLeft: (error) => {
        throw new Error(`unexpected error ${error._tag}`)
      },
      onRight: (command) => {
        if (command._tag !== "Create") {
          throw new Error("expected Create command")
        }
        onRight(command)
      }
    })
  })

const expectCreateDefaults = (command: CreateCommand) => {
  expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
  expect(command.config.repoRef).toBe(defaultTemplateConfig.repoRef)
  expect(command.outDir).toBe(".docker-git/org/repo")
  expect(command.runUp).toBe(true)
}

describe("parseArgs", () => {
  it.effect("parses create command with defaults", () =>
    expectCreateCommand(["create", "--repo-url", "https://github.com/org/repo.git"], (command) => {
      expectCreateDefaults(command)
      expect(command.config.containerName).toBe("dg-repo")
      expect(command.config.serviceName).toBe("dg-repo")
      expect(command.config.volumeName).toBe("dg-repo-home")
      expect(command.config.sshPort).toBe(defaultTemplateConfig.sshPort)
    }))

  it.effect("fails on missing repo url", () =>
    Effect.sync(() => {
      Either.match(parseArgs(["create"]), {
        onLeft: (error) => {
          expect(error._tag).toBe("MissingRequiredOption")
        },
        onRight: () => {
          throw new Error("expected parse error")
        }
      })
    }))

  it.effect("parses clone command with positional repo url", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git"], (command) => {
      expectCreateDefaults(command)
      expect(command.config.targetDir).toBe("/home/dev/org/repo")
    }))

  it.effect("parses clone branch alias", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--branch", "feature-x"], (command) => {
      expect(command.config.repoRef).toBe("feature-x")
    }))

  it.effect("parses down-all command", () =>
    Effect.sync(() => {
      Either.match(parseArgs(["down-all"]), {
        onLeft: (error) => {
          throw new Error(`unexpected error ${error._tag}`)
        },
        onRight: (command: Command) => {
          expect(command._tag).toBe("DownAll")
        }
      })
    }))
})
