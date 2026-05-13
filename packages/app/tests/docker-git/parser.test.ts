import { describe, expect, it } from "@effect/vitest"

import { defaultTemplateConfig } from "../../src/docker-git/frontend-lib/core/domain.js"
import { expandContainerHome } from "../../src/docker-git/frontend-lib/usecases/scrap-path.js"
import {
  type CreateCommand,
  expectAttachProjectDirCommand,
  expectCreateCommand,
  expectOpenCommand,
  expectParseErrorTag
} from "./parser-helpers.js"

const expectCreateDefaults = (command: CreateCommand) => {
  expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
  expect(command.config.repoRef).toBe(defaultTemplateConfig.repoRef)
  expect(command.outDir).toBe(".docker-git/org/repo")
  expect(command.runUp).toBe(true)
  expect(command.forceEnv).toBe(false)
  expect(command.config.skipGithubAuth).toBe(false)
  expect(command.config.cpuLimit).toBe("30%")
  expect(command.config.ramLimit).toBe("30%")
  expect(command.config.gpu).toBe("none")
  expect(command.config.dockerNetworkMode).toBe("shared")
  expect(command.config.dockerSharedNetworkName).toBe("docker-git-shared")
}

const expandDefaultTargetDir = (path: string): string => expandContainerHome(defaultTemplateConfig.sshUser, path)

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
      expect(command.config.clonedOnHostname).toBeUndefined()
    }))

  it.effect("parses create resource limit flags", () =>
    expectCreateCommand(
      ["create", "--repo-url", "https://github.com/org/repo.git", "--cpu", "30%", "--ram", "3072m"],
      (command) => {
        expect(command.config.cpuLimit).toBe("30%")
        expect(command.config.ramLimit).toBe("3072m")
      }
    ))

  it.effect("accepts legacy compose-style limit aliases", () =>
    expectCreateCommand(
      ["create", "--repo-url", "https://github.com/org/repo.git", "--cpus", "1.5", "--memory", "4g"],
      (command) => {
        expect(command.config.cpuLimit).toBe("1.5")
        expect(command.config.ramLimit).toBe("4g")
      }
    ))

  it.effect("parses create GPU mode", () =>
    expectCreateCommand(
      ["create", "--repo-url", "https://github.com/org/repo.git", "--gpu", "all"],
      (command) => {
        expect(command.config.gpu).toBe("all")
      }
    ))

  it.effect("rejects unitless RAM absolute limit", () =>
    expectParseErrorTag(["create", "--repo-url", "https://github.com/org/repo.git", "--ram", "4096"], "InvalidOption"))

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

  it.effect("parses create command without repo url into empty workspace defaults", () =>
    expectCreateCommand(["create"], (command) => {
      expect(command.config.repoUrl).toBe("")
      expect(command.config.repoRef).toBe(defaultTemplateConfig.repoRef)
      expect(command.outDir).toBe(".docker-git/app")
      expect(command.openSsh).toBe(false)
      expect(command.waitForClone).toBe(false)
      expect(command.config.containerName).toBe("dg-app")
      expect(command.config.serviceName).toBe("dg-app")
      expect(command.config.volumeName).toBe("dg-app-home")
      expect(command.config.targetDir).toBe(expandDefaultTargetDir(defaultTemplateConfig.targetDir))
    }))

  it.effect("fails clone when repo url is missing", () => expectParseErrorTag(["clone"], "MissingRequiredOption"))

  it.effect("parses clone command with positional repo url", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git"], (command) => {
      expectCreateDefaults(command)
      expect(command.openSsh).toBe(true)
      expect(command.waitForClone).toBe(true)
      expect(command.config.targetDir).toBe(
        expandDefaultTargetDir("~/workspaces/org/repo")
      )
    }))

  it.effect("parses clone branch alias", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--branch", "feature-x"], (command) => {
      expect(command.config.repoRef).toBe("feature-x")
    }))

  it.effect("supports disabling SSH auto-open for clone", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--no-ssh"], (command) => {
      expect(command.openSsh).toBe(false)
    }))

  it.effect("parses clone git token label from inline option and normalizes it", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--git-token=#agiens"], (command) => {
      expect(command.config.gitTokenLabel).toBe("AGIENS")
    }))

  it.effect("parses explicit GitHub auth skip for create", () =>
    expectCreateCommand(["create", "--repo-url", "https://github.com/org/repo.git", "--gh-skip"], (command) => {
      expect(command.config.skipGithubAuth).toBe(true)
    }))

  it.effect("parses explicit GitHub auth skip for clone", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--gh-skip"], (command) => {
      expect(command.config.skipGithubAuth).toBe(true)
    }))

  it.effect("parses clone codex/claude token labels from inline options and normalizes them", () =>
    expectCreateCommand(
      [
        "clone",
        "https://github.com/org/repo.git",
        "--codex-token= Team A ",
        "--claude-token=---AGIENS:::Claude---"
      ],
      (command) => {
        expect(command.config.codexAuthLabel).toBe("team-a")
        expect(command.config.claudeAuthLabel).toBe("agiens-claude")
      }
    ))

  it.effect("supports enabling SSH auto-open for create", () =>
    expectCreateCommand(["create", "--repo-url", "https://github.com/org/repo.git", "--ssh"], (command) => {
      expect(command.openSsh).toBe(true)
    }))

  it.effect("parses bare --auto for clone", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--auto"], (command) => {
      expect(command.config.agentAuto).toBe(true)
      expect(command.config.agentMode).toBeUndefined()
    }))

  it.effect("parses --auto=claude for clone", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--auto=claude"], (command) => {
      expect(command.config.agentAuto).toBe(true)
      expect(command.config.agentMode).toBe("claude")
    }))

  it.effect("parses --auto=codex for clone", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo.git", "--auto=codex"], (command) => {
      expect(command.config.agentAuto).toBe(true)
      expect(command.config.agentMode).toBe("codex")
    }))

  it.effect("rejects legacy --claude flag", () =>
    expectParseErrorTag(["clone", "https://github.com/org/repo.git", "--claude", "--auto"], "InvalidOption"))

  it.effect("rejects legacy --codex flag", () =>
    expectParseErrorTag(["clone", "https://github.com/org/repo.git", "--codex", "--auto"], "InvalidOption"))

  it.effect("rejects invalid --auto value", () =>
    expectParseErrorTag(["clone", "https://github.com/org/repo.git", "--auto=foo"], "InvalidOption"))

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
      expect(command.config.targetDir).toBe(
        expandDefaultTargetDir("~/workspaces/agiens/crm")
      )
    }))

  it.effect("parses GitHub issue url as isolated project + issue branch", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo/issues/5"], (command) => {
      expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
      expect(command.config.repoRef).toBe("issue-5")
      expect(command.outDir).toBe(".docker-git/org/repo/issue-5")
      expect(command.config.targetDir).toBe(
        expandDefaultTargetDir("~/workspaces/org/repo/issue-5")
      )
      expect(command.config.containerName).toBe("dg-repo-issue-5")
      expect(command.config.serviceName).toBe("dg-repo-issue-5")
      expect(command.config.volumeName).toBe("dg-repo-issue-5-home")
    }))

  it.effect("parses GitHub PR url as isolated project", () =>
    expectCreateCommand(["clone", "https://github.com/org/repo/pull/42"], (command) => {
      expect(command.config.repoUrl).toBe("https://github.com/org/repo.git")
      expect(command.config.repoRef).toBe("refs/pull/42/head")
      expect(command.outDir).toBe(".docker-git/org/repo/pr-42")
      expect(command.config.targetDir).toBe(
        expandDefaultTargetDir("~/workspaces/org/repo/pr-42")
      )
      expect(command.config.containerName).toBe("dg-repo-pr-42")
      expect(command.config.serviceName).toBe("dg-repo-pr-42")
      expect(command.config.volumeName).toBe("dg-repo-pr-42-home")
    }))

  it.effect("parses attach with GitHub issue url into issue workspace", () =>
    expectAttachProjectDirCommand(["attach", "https://github.com/org/repo/issues/7"], ".docker-git/org/repo/issue-7"))

  it.effect("parses open with GitHub issue url as a raw selector", () =>
    expectOpenCommand(["open", "https://github.com/org/repo/issues/7"], (command) => {
      expect(command.projectRef).toBe("https://github.com/org/repo/issues/7")
      expect(command.projectDir).toBeUndefined()
    }))

  it.effect("parses open with explicit project dir override", () =>
    expectOpenCommand(["open", "--project-dir", ".docker-git/org/repo"], (command) => {
      expect(command.projectRef).toBeUndefined()
      expect(command.projectDir).toBe(".docker-git/org/repo")
    }))

  it.effect("parses open with container-name selector flag", () =>
    expectOpenCommand(["open", "--container-name", "dg-repo-issue-7"], (command) => {
      expect(command.projectRef).toBe("dg-repo-issue-7")
      expect(command.projectDir).toBeUndefined()
    }))

  it.effect("parses open without selector for automatic resolution", () =>
    expectOpenCommand(["open"], (command) => {
      expect(command.projectRef).toBeUndefined()
      expect(command.projectDir).toBeUndefined()
    }))
})
