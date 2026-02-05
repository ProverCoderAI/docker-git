import { describe, expect, it } from "@effect/vitest"
import { Effect, Either } from "effect"

import { defaultTemplateConfig } from "@effect-template/lib/core/domain"
import { parseArgs } from "../../src/docker-git/cli/parser.js"

describe("parseArgs", () => {
  it.effect("parses create command with defaults", () =>
    Effect.sync(() => {
      Either.match(parseArgs(["create", "--repo-url", "https://github.com/org/repo.git"]), {
        onLeft: (error) => {
          throw new Error(`unexpected error ${error._tag}`)
        },
        onRight: (command) => {
          if (command._tag !== "Create") {
            throw new Error("expected Create command")
          }
          expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
          expect(command.config.repoRef).toBe(defaultTemplateConfig.repoRef)
          expect(command.config.containerName).toBe("dg-repo")
          expect(command.config.serviceName).toBe("dg-repo")
          expect(command.config.volumeName).toBe("dg-repo-home")
          expect(command.config.sshPort).toBe(defaultTemplateConfig.sshPort)
          expect(command.outDir).toBe(".")
          expect(command.runUp).toBe(true)
        }
      })
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
    Effect.sync(() => {
      Either.match(parseArgs(["clone", "https://github.com/org/repo.git"]), {
        onLeft: (error) => {
          throw new Error(`unexpected error ${error._tag}`)
        },
        onRight: (command) => {
          if (command._tag !== "Create") {
            throw new Error("expected Create command")
          }
          expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
          expect(command.config.repoRef).toBe(defaultTemplateConfig.repoRef)
          expect(command.config.targetDir).toBe("/home/dev/org/repo")
          expect(command.outDir).toBe(".docker-git/org/repo")
          expect(command.runUp).toBe(true)
        }
      })
    }))

  it.effect("parses clone branch alias", () =>
    Effect.sync(() => {
      Either.match(parseArgs(["clone", "https://github.com/org/repo.git", "--branch", "feature-x"]), {
        onLeft: (error) => {
          throw new Error(`unexpected error ${error._tag}`)
        },
        onRight: (command) => {
          if (command._tag !== "Create") {
            throw new Error("expected Create command")
          }
          expect(command.config.repoRef).toBe("feature-x")
        }
      })
    }))
})
