import { describe, expect, it } from "@effect/vitest"
import { Effect, Either } from "effect"

import { type Command, defaultTemplateConfig } from "@effect-template/lib/core/domain"
import { parseArgs } from "../../src/docker-git/cli/parser.js"

type CreateCommand = Extract<Command, { _tag: "Create" }>

const parseOrThrow = (args: ReadonlyArray<string>): Command => {
  const parsed = parseArgs(args)
  return Either.match(parsed, {
    onLeft: (error) => {
      throw new Error(`unexpected error ${error._tag}`)
    },
    onRight: (command) => command
  })
}

const expectCreateCommand = (
  args: ReadonlyArray<string>,
  onRight: (command: CreateCommand) => void
) =>
  Effect.sync(() => {
    const command = parseOrThrow(args)
    if (command._tag !== "Create") {
      throw new Error("expected Create command")
    }
    onRight(command)
  })

const expectCreateDefaults = (command: CreateCommand) => {
  expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
  expect(command.config.repoRef).toBe(defaultTemplateConfig.repoRef)
  expect(command.outDir).toBe(".docker-git/org/repo")
  expect(command.runUp).toBe(true)
  expect(command.forceEnv).toBe(false)
}

describe("parseArgs", () => {
  it.effect("parses create command with defaults", () =>
    expectCreateCommand(["create", "--repo-url", "https://github.com/org/repo.git"], (command) => {
      expectCreateDefaults(command)
      expect(command.openSsh).toBe(false)
      expect(command.waitForClone).toBe(false)
      expect(command.config.containerName).toBe("dg-repo")
      expect(command.config.serviceName).toBe("dg-repo")
      expect(command.config.volumeName).toBe("dg-repo-home")
      expect(command.config.sshPort).toBe(defaultTemplateConfig.sshPort)
    }))

  it.effect("parses create command with issue url into isolated defaults", () =>
    expectCreateCommand(["create", "--repo-url", "https://github.com/org/repo/issues/9"], (command) => {
      expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
      expect(command.config.repoRef).toBe("issue-9")
      expect(command.outDir).toBe(".docker-git/org/repo/issue-9")
      expect(command.openSsh).toBe(false)
      expect(command.waitForClone).toBe(false)
      expect(command.config.containerName).toBe("dg-repo-issue-9")
      expect(command.config.serviceName).toBe("dg-repo-issue-9")
      expect(command.config.volumeName).toBe("dg-repo-issue-9-home")
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
      expect(command.openSsh).toBe(true)
      expect(command.waitForClone).toBe(true)
      expect(command.config.targetDir).toBe("/home/dev/org/repo")
    }))

  it.effect("parses clone branch alias", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--branch", "feature-x"], (command) => {
      expect(command.config.repoRef).toBe("feature-x")
    }))

  it.effect("supports disabling SSH auto-open for clone", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--no-ssh"], (command) => {
      expect(command.openSsh).toBe(false)
    }))

  it.effect("supports enabling SSH auto-open for create", () =>
    expectCreateCommand(["create", "--repo-url", "https://github.com/org/repo.git", "--ssh"], (command) => {
      expect(command.openSsh).toBe(true)
    }))

  it.effect("parses force-env flag for clone", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--force-env"], (command) => {
      expect(command.force).toBe(false)
      expect(command.forceEnv).toBe(true)
    }))

  it.effect("supports force + force-env together", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--force", "--force-env"], (command) => {
      expect(command.force).toBe(true)
      expect(command.forceEnv).toBe(true)
    }))

  it.effect("parses GitHub tree url as repo + ref", () =>
    expectCreateCommand(["clone", "https://github.com/agiens/crm/tree/vova-fork"], (command) => {
      expect(command.config.repoUrl).toBe("https://github.com/agiens/crm.git")
      expect(command.config.repoRef).toBe("vova-fork")
      expect(command.outDir).toBe(".docker-git/agiens/crm")
      expect(command.config.targetDir).toBe("/home/dev/agiens/crm")
    }))

  it.effect("parses GitHub issue url as isolated project + issue branch", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo/issues/5"], (command) => {
      expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
      expect(command.config.repoRef).toBe("issue-5")
      expect(command.outDir).toBe(".docker-git/org/repo/issue-5")
      expect(command.config.targetDir).toBe("/home/dev/org/repo/issue-5")
      expect(command.config.containerName).toBe("dg-repo-issue-5")
      expect(command.config.serviceName).toBe("dg-repo-issue-5")
      expect(command.config.volumeName).toBe("dg-repo-issue-5-home")
    }))

  it.effect("parses GitHub PR url as isolated project", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo/pull/42"], (command) => {
      expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
      expect(command.config.repoRef).toBe("refs/pull/42/head")
      expect(command.outDir).toBe(".docker-git/org/repo/pr-42")
      expect(command.config.targetDir).toBe("/home/dev/org/repo/pr-42")
      expect(command.config.containerName).toBe("dg-repo-pr-42")
      expect(command.config.serviceName).toBe("dg-repo-pr-42")
      expect(command.config.volumeName).toBe("dg-repo-pr-42-home")
    }))

  it.effect("parses attach with GitHub issue url into issue workspace", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["attach", "https://github.com/org/repo/issues/7"])
      if (command._tag !== "Attach") {
        throw new Error("expected Attach command")
      }
      expect(command.projectDir).toBe(".docker-git/org/repo/issue-7")
    }))

  it.effect("parses down-all command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["down-all"])
      expect(command._tag).toBe("DownAll")
    }))

  it.effect("parses state path command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["state", "path"])
      expect(command._tag).toBe("StatePath")
    }))

  it.effect("parses state init command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["state", "init", "--repo-url", "https://github.com/org/state.git"])
      if (command._tag !== "StateInit") {
        throw new Error("expected StateInit command")
      }
      expect(command.repoUrl).toBe("https://github.com/org/state.git")
      expect(command.repoRef).toBe("main")
    }))

  it.effect("parses state commit command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["state", "commit", "-m", "sync state"])
      if (command._tag !== "StateCommit") {
        throw new Error("expected StateCommit command")
      }
      expect(command.message).toBe("sync state")
    }))

  it.effect("parses state sync command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["state", "sync", "-m", "sync state"])
      if (command._tag !== "StateSync") {
        throw new Error("expected StateSync command")
      }
      expect(command.message).toBe("sync state")
    }))
})
