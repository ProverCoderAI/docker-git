import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { defaultTemplateConfig } from "../../src/docker-git/frontend-lib/core/domain.js"
import { expandContainerHome } from "../../src/docker-git/frontend-lib/usecases/scrap-path.js"
import { expectAttachProjectDirCommand, parseOrThrow } from "./parser-helpers.js"

type GitlabCreateCase = {
  readonly args: ReadonlyArray<string>
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly targetDir: string
  readonly containerName?: string
  readonly serviceName?: string
  readonly volumeName?: string
}

const expandDefaultTargetDir = (path: string): string => expandContainerHome(defaultTemplateConfig.sshUser, path)

const gitlabCreateCases: ReadonlyArray<GitlabCreateCase> = [
  {
    args: ["clone", "https://gitlab.com/group/subgroup/repo.git"],
    repoUrl: "https://gitlab.com/group/subgroup/repo.git",
    repoRef: defaultTemplateConfig.repoRef,
    outDir: ".docker-git/group/subgroup/repo",
    targetDir: expandDefaultTargetDir("~/workspaces/group/subgroup/repo"),
    containerName: "dg-repo",
    serviceName: "dg-repo",
    volumeName: "dg-repo-home"
  },
  {
    args: ["clone", "https://gitlab.com/group/subgroup/repo/-/tree/release-1"],
    repoUrl: "https://gitlab.com/group/subgroup/repo.git",
    repoRef: "release-1",
    outDir: ".docker-git/group/subgroup/repo",
    targetDir: expandDefaultTargetDir("~/workspaces/group/subgroup/repo")
  },
  {
    args: ["clone", "https://gitlab.com/group/subgroup/repo.git/-/blob/main/README.md"],
    repoUrl: "https://gitlab.com/group/subgroup/repo.git",
    repoRef: "main",
    outDir: ".docker-git/group/subgroup/repo",
    targetDir: expandDefaultTargetDir("~/workspaces/group/subgroup/repo")
  },
  {
    args: ["clone", "ssh://git@gitlab.com/group/subgroup/repo.git/-/issues/8"],
    repoUrl: "https://gitlab.com/group/subgroup/repo.git",
    repoRef: "issue-8",
    outDir: ".docker-git/group/subgroup/repo/issue-8",
    targetDir: expandDefaultTargetDir("~/workspaces/group/subgroup/repo/issue-8"),
    containerName: "dg-repo-issue-8",
    serviceName: "dg-repo-issue-8",
    volumeName: "dg-repo-issue-8-home"
  },
  {
    args: ["clone", "git@gitlab.com:group/subgroup/repo/-/merge_requests/17"],
    repoUrl: "https://gitlab.com/group/subgroup/repo.git",
    repoRef: "refs/merge-requests/17/head",
    outDir: ".docker-git/group/subgroup/repo/mr-17",
    targetDir: expandDefaultTargetDir("~/workspaces/group/subgroup/repo/mr-17"),
    containerName: "dg-repo-mr-17",
    serviceName: "dg-repo-mr-17",
    volumeName: "dg-repo-mr-17-home"
  }
]

describe("parseArgs GitLab repo URLs", () => {
  it.effect("parses GitLab clone URLs into repo refs and workspace paths", () =>
    Effect.sync(() => {
      for (const testCase of gitlabCreateCases) {
        const command = parseOrThrow(testCase.args)
        if (command._tag !== "Create") {
          throw new Error("expected Create command")
        }
        expect(command.config.repoUrl).toBe(testCase.repoUrl)
        expect(command.config.repoRef).toBe(testCase.repoRef)
        expect(command.outDir).toBe(testCase.outDir)
        expect(command.config.targetDir).toBe(testCase.targetDir)
        if (testCase.containerName) {
          expect(command.config.containerName).toBe(testCase.containerName)
        }
        if (testCase.serviceName) {
          expect(command.config.serviceName).toBe(testCase.serviceName)
        }
        if (testCase.volumeName) {
          expect(command.config.volumeName).toBe(testCase.volumeName)
        }
      }
    }))

  it.effect("parses GitLab ssh repo url into project dir", () =>
    expectAttachProjectDirCommand(
      ["attach", "ssh://git@gitlab.com/group/subgroup/repo.git"],
      ".docker-git/group/subgroup/repo"
    ))

  it.effect("parses GitLab https repo url without .git into project dir", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["mcp-playwright", "https://gitlab.com/group/subgroup/repo"])
      if (command._tag !== "McpPlaywrightUp") {
        throw new Error("expected McpPlaywrightUp command")
      }
      expect(command.projectDir).toBe(".docker-git/group/subgroup/repo")
    }))

  it.effect("parses GitLab scp-style repo url into project dir", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["apply", "git@gitlab.com:group/subgroup/repo.git"])
      if (command._tag !== "Apply") {
        throw new Error("expected Apply command")
      }
      expect(command.projectDir).toBe(".docker-git/group/subgroup/repo")
    }))
})
