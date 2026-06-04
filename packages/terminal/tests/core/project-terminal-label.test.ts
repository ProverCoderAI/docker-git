import { describe, expect, it } from "vitest"

import { projectTerminalLabel } from "../../src/core/project-terminal-label.js"

describe("projectTerminalLabel", () => {
  it("renders GitHub issue source context and container identity", () => {
    expect(projectTerminalLabel({
      containerName: "dg-repo-issue-7",
      displayName: "org/repo",
      repoRef: "issue-7",
      repoUrl: "https://github.com/org/repo.git"
    })).toBe("org/repo | issue #7 (https://github.com/org/repo/issues/7) | container dg-repo-issue-7")
  })

  it("renders GitHub pull request source context from pull refs", () => {
    expect(projectTerminalLabel({
      containerName: "dg-repo-pr-42",
      displayName: "org/repo",
      repoRef: "refs/pull/42/head",
      repoUrl: "git@github.com:org/repo.git"
    })).toBe("org/repo | PR #42 (https://github.com/org/repo/pull/42) | container dg-repo-pr-42")
  })

  it("renders repository source context for ordinary refs", () => {
    expect(projectTerminalLabel({
      displayName: "org/repo",
      repoRef: "feature-x",
      repoUrl: "https://github.com/org/repo.git"
    })).toBe("org/repo | source https://github.com/org/repo.git (feature-x)")
  })
})
