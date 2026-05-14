import { describe, expect, it } from "vitest"

import {
  defaultGithubScopes,
  hasGithubRepositoryDeleteScope,
  normalizeGithubScopes,
  parseGithubOauthScopesHeader
} from "../../src/usecases/github-scope-policy.js"

describe("github scope policy", () => {
  it("preserves default safe scopes", () => {
    expect(normalizeGithubScopes(null)).toEqual(defaultGithubScopes)
    expect(normalizeGithubScopes("")).toEqual(defaultGithubScopes)
  })

  it("accepts comma and space separated scopes", () => {
    expect(normalizeGithubScopes("repo,workflow read:org")).toEqual(["repo", "workflow", "read:org"])
  })

  it("removes delete_repo case-insensitively", () => {
    expect(normalizeGithubScopes("repo,DELETE_REPO workflow delete_repo")).toEqual(["repo", "workflow"])
  })

  it("falls back to defaults when every requested scope is forbidden", () => {
    expect(normalizeGithubScopes("delete_repo DELETE_REPO")).toEqual(defaultGithubScopes)
  })

  it("parses GitHub OAuth scope headers and detects repository deletion", () => {
    expect(parseGithubOauthScopesHeader(null)).toBe(null)
    expect(parseGithubOauthScopesHeader(undefined)).toBe(null)
    expect(parseGithubOauthScopesHeader("repo, workflow, delete_repo")).toEqual(["repo", "workflow", "delete_repo"])
    expect(hasGithubRepositoryDeleteScope(["repo", "DELETE_REPO"])).toBe(true)
    expect(hasGithubRepositoryDeleteScope(["repo", "workflow"])).toBe(false)
    expect(hasGithubRepositoryDeleteScope(null)).toBe(false)
  })
})
