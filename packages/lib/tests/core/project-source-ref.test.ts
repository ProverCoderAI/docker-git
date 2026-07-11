import { describe, expect, it } from "vitest"

import {
  normalizeProjectSourceState,
  parseProjectSourceRef,
  shouldDeleteForSourceState
} from "../../src/core/project-source-ref.js"

describe("parseProjectSourceRef", () => {
  it("recovers a GitHub issue identity from issue-<n>", () => {
    expect(parseProjectSourceRef("https://github.com/owner/repo.git", "issue-42")).toEqual({
      provider: "github",
      owner: "owner",
      repo: "repo",
      kind: "issue",
      number: "42"
    })
  })

  it("recovers a GitHub pull-request identity from refs/pull/<n>/head", () => {
    expect(parseProjectSourceRef("https://github.com/owner/repo.git", "refs/pull/7/head")).toEqual({
      provider: "github",
      owner: "owner",
      repo: "repo",
      kind: "pull",
      number: "7"
    })
  })

  it("recovers a GitLab merge-request identity from refs/merge-requests/<n>/head", () => {
    expect(parseProjectSourceRef("https://gitlab.com/group/repo.git", "refs/merge-requests/9/head")).toEqual({
      provider: "gitlab",
      owner: "group/repo",
      repo: "repo",
      kind: "pull",
      number: "9"
    })
  })

  it("recovers a GitLab issue identity from issue-<n>", () => {
    expect(parseProjectSourceRef("https://gitlab.com/group/sub/repo.git", "issue-3")).toEqual({
      provider: "gitlab",
      owner: "group/sub/repo",
      repo: "repo",
      kind: "issue",
      number: "3"
    })
  })

  it("trims surrounding whitespace from the ref", () => {
    expect(parseProjectSourceRef("https://github.com/owner/repo.git", "  issue-1  ")?.number).toBe("1")
  })

  it("returns null for a plain branch ref", () => {
    expect(parseProjectSourceRef("https://github.com/owner/repo.git", "main")).toBeNull()
  })

  it("returns null for an empty ref", () => {
    expect(parseProjectSourceRef("https://github.com/owner/repo.git", "   ")).toBeNull()
  })

  it("returns null when the repo URL is not a known provider", () => {
    expect(parseProjectSourceRef("https://example.com/owner/repo.git", "issue-1")).toBeNull()
  })

  it("does not treat a GitHub merge-request style ref as a pull request", () => {
    expect(parseProjectSourceRef("https://github.com/owner/repo.git", "refs/merge-requests/9/head")).toBeNull()
  })
})

describe("normalizeProjectSourceState", () => {
  it("maps GitHub open to open", () => {
    expect(normalizeProjectSourceState("open")).toBe("open")
  })

  it("maps GitLab opened to open", () => {
    expect(normalizeProjectSourceState("opened")).toBe("open")
  })

  it("maps closed to closed", () => {
    expect(normalizeProjectSourceState("closed")).toBe("closed")
  })

  it("maps GitLab merged to closed", () => {
    expect(normalizeProjectSourceState("merged")).toBe("closed")
  })

  it("maps GitLab locked to closed", () => {
    expect(normalizeProjectSourceState("locked")).toBe("closed")
  })

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeProjectSourceState("  CLOSED  ")).toBe("closed")
  })

  it("maps unrecognized values to unknown", () => {
    expect(normalizeProjectSourceState("draft")).toBe("unknown")
  })

  it("maps null and undefined to unknown", () => {
    expect(normalizeProjectSourceState(null)).toBe("unknown")
    expect(normalizeProjectSourceState(undefined)).toBe("unknown")
  })
})

describe("shouldDeleteForSourceState", () => {
  it("deletes only when the source is closed", () => {
    expect(shouldDeleteForSourceState("closed")).toBe(true)
  })

  it("never deletes for open or unknown", () => {
    expect(shouldDeleteForSourceState("open")).toBe(false)
    expect(shouldDeleteForSourceState("unknown")).toBe(false)
  })
})
