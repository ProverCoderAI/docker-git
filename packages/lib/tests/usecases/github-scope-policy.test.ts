import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  defaultGithubScopes,
  hasGithubRepositoryDeleteScope,
  normalizeGithubScopes,
  parseGithubOauthScopesHeader
} from "../../src/usecases/github-scope-policy.js"

describe("github scope policy", () => {
  const deleteRepoScopeArbitrary = fc.constantFrom("delete_repo", "DELETE_REPO", "Delete_Repo", " delete_repo ")
  const separatorArbitrary = fc.constantFrom(",", " ", "\n", "\t", ", ", " , ")
  const scopeTokenArbitrary = fc.oneof(fc.string(), deleteRepoScopeArbitrary)
  const scopeListInputArbitrary = fc.array(scopeTokenArbitrary, { maxLength: 20 }).chain((scopes) =>
    fc.array(separatorArbitrary, { minLength: scopes.length, maxLength: scopes.length }).map((separators) =>
      scopes.map((scope, index) => `${scope}${separators[index] ?? ""}`).join("")
    )
  )
  const nullableScopeInputArbitrary = fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), scopeListInputArbitrary)
  const forbiddenOnlyInputArbitrary = fc.array(deleteRepoScopeArbitrary, { minLength: 1, maxLength: 20 }).chain((scopes) =>
    fc.array(separatorArbitrary, { minLength: scopes.length, maxLength: scopes.length }).map((separators) =>
      scopes.map((scope, index) => `${scope}${separators[index] ?? ""}`).join("")
    )
  )

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

  it("preserves the no-delete-repo invariant for arbitrary scope inputs", () => {
    fc.assert(
      fc.property(nullableScopeInputArbitrary, (input) => {
        expect(
          normalizeGithubScopes(input).some((scope) => scope.trim().toLowerCase() === "delete_repo")
        ).toBe(false)
      })
    )
    fc.assert(
      fc.property(forbiddenOnlyInputArbitrary, (input) => {
        expect(normalizeGithubScopes(input)).toEqual(defaultGithubScopes)
      })
    )
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
