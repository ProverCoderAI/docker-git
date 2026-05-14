export const defaultGithubScopes: ReadonlyArray<string> = Object.freeze(["repo", "workflow", "read:org"])
export const githubRepositoryDeleteScope = "delete_repo"
export const githubForbiddenDeleteRepoScopeMessage = [
  "GitHub auth token includes forbidden OAuth scope: delete_repo.",
  "Repository deletion is not allowed for docker-git tokens. The token was not stored."
].join("\n")
export const githubUnverifiedTokenScopesMessage = [
  "Unable to verify GitHub token OAuth scopes.",
  "The token was not stored because docker-git could not confirm repository deletion is disabled."
].join("\n")

const scopeSeparator = /[,\s]+/g

const normalizeScopeForComparison = (scope: string): string => scope.trim().toLowerCase()

const isGithubRepositoryDeleteScope = (scope: string): boolean =>
  normalizeScopeForComparison(scope) === githubRepositoryDeleteScope

// CHANGE: centralize GitHub OAuth scope normalization
// WHY: every auth surface must request useful scopes while excluding repository deletion
// QUOTE(user): "Generated GitHub tokens must not be able to delete repositories."
// REF: issue-288
// SOURCE: n/a
// FORMAT THEOREM: forall input: delete_repo notin normalizeGithubScopes(input)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: empty or all-forbidden input falls back to default safe scopes
// COMPLEXITY: O(n) where n = |input scopes|
export const normalizeGithubScopes = (value: string | null | undefined): ReadonlyArray<string> => {
  const raw = value?.trim() ?? ""
  const input = raw.length === 0 ? defaultGithubScopes.join(",") : raw
  const scopes = input
    .split(scopeSeparator)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0 && !isGithubRepositoryDeleteScope(scope))
  return scopes.length === 0 ? defaultGithubScopes : scopes
}

// CHANGE: parse GitHub's X-OAuth-Scopes response header
// WHY: persisted tokens must be checked against the effective scopes granted by GitHub
// QUOTE(user): "Generated GitHub tokens must not be able to delete repositories."
// REF: issue-288
// SOURCE: n/a
// FORMAT THEOREM: forall header: parse(header) = granted OAuth scopes or empty
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: absent header remains unknown; empty header is a known empty scope set
// COMPLEXITY: O(n) where n = |header|
export const parseGithubOauthScopesHeader = (value: string | null | undefined): ReadonlyArray<string> | null => {
  if (value === null || value === undefined) {
    return null
  }
  return value
    .split(scopeSeparator)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)
}

export const hasGithubRepositoryDeleteScope = (scopes: ReadonlyArray<string> | null): boolean =>
  scopes?.some((scope) => isGithubRepositoryDeleteScope(scope)) ?? false
