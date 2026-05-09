import { describe, expect, it } from "@effect/vitest"

import {
  isGitlabHttpsRemote,
  normalizeGitlabHttpsRemote,
  tryBuildGitlabCompareUrl
} from "../../src/usecases/state-repo/gitlab-auth.js"

describe("state-repo gitlab auth helpers", () => {
  it("detects GitLab HTTPS remotes", () => {
    expect(isGitlabHttpsRemote("https://gitlab.com/group/project.git")).toBe(true)
    expect(isGitlabHttpsRemote("https://oauth2:token@gitlab.com/group/sub/project.git")).toBe(true)
    expect(isGitlabHttpsRemote("git@gitlab.com:group/project.git")).toBe(false)
    expect(isGitlabHttpsRemote("https://github.com/group/project.git")).toBe(false)
  })

  it("normalizes GitLab HTTPS remotes without leaking embedded credentials", () => {
    expect(normalizeGitlabHttpsRemote("https://gitlab.com/group/sub/project")).toBe(
      "https://gitlab.com/group/sub/project.git"
    )
    expect(normalizeGitlabHttpsRemote("https://oauth2:secret@gitlab.com/group/project.git")).toBe(
      "https://gitlab.com/group/project.git"
    )
    expect(normalizeGitlabHttpsRemote("git@gitlab.com:group/project.git")).toBeNull()
  })

  it("builds GitLab compare URLs for fallback state branches", () => {
    expect(
      tryBuildGitlabCompareUrl(
        "https://gitlab.com/group/sub/project.git",
        "main",
        "state-sync/main/2026-05-09"
      )
    ).toBe("https://gitlab.com/group/sub/project/-/compare/main...state-sync%2Fmain%2F2026-05-09")
    expect(tryBuildGitlabCompareUrl("https://github.com/group/project.git", "main", "branch")).toBeNull()
  })
})
