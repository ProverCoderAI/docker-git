import { parseGithubRepoUrl, parseGitlabRepoUrl } from "./repo.js"

// CHANGE: derive the originating issue/PR identity of a docker-git project
// WHY: enable automatic cleanup of containers whose issue or PR has been closed
// QUOTE(ТЗ): "Сделать возможность автоматического удаления контейнера issues или PR которого уже закрылся"
// REF: issue-117
// SOURCE: https://github.com/ProverCoderAI/docker-git/issues/117
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returns null unless the project clearly originates from an issue or PR/MR
// COMPLEXITY: O(n) where n = |repoUrl| + |repoRef|

export type ProjectSourceProvider = "github" | "gitlab"

export type ProjectSourceKind = "issue" | "pull"

/**
 * Identity of the GitHub/GitLab issue or pull/merge request a project was cloned from.
 *
 * For GitLab projects `owner` carries the full namespace path (e.g. `group/subgroup`).
 */
export type ProjectSourceRef = {
  readonly provider: ProjectSourceProvider
  readonly owner: string
  readonly repo: string
  readonly kind: ProjectSourceKind
  readonly number: string
}

// A project cloned from an issue stores `repoRef = issue-<number>` for both providers.
const issueRefRe = /^issue-(\d+)$/u
// A project cloned from a GitHub PR stores `repoRef = refs/pull/<number>/head`.
const githubPullRefRe = /^refs\/pull\/(\d+)\/head$/u
// A project cloned from a GitLab MR stores `repoRef = refs/merge-requests/<number>/head`.
const gitlabMergeRequestRefRe = /^refs\/merge-requests\/(\d+)\/head$/u

type RefIdentity = {
  readonly kind: ProjectSourceKind
  readonly number: string
}

const parseGithubRefIdentity = (repoRef: string): RefIdentity | null => {
  const issue = issueRefRe.exec(repoRef)
  if (issue?.[1]) {
    return { kind: "issue", number: issue[1] }
  }
  const pull = githubPullRefRe.exec(repoRef)
  if (pull?.[1]) {
    return { kind: "pull", number: pull[1] }
  }
  return null
}

const parseGitlabRefIdentity = (repoRef: string): RefIdentity | null => {
  const issue = issueRefRe.exec(repoRef)
  if (issue?.[1]) {
    return { kind: "issue", number: issue[1] }
  }
  const mr = gitlabMergeRequestRefRe.exec(repoRef)
  if (mr?.[1]) {
    return { kind: "pull", number: mr[1] }
  }
  return null
}

/**
 * Parse the issue/PR identity that a project was cloned from.
 *
 * Mirrors the inverse of {@link resolveRepoInput}: PR/issue/MR URLs are normalized
 * into a `repoUrl` + `repoRef` pair at clone time, and this recovers the original
 * issue or pull/merge request number so its open/closed state can be queried.
 *
 * @param repoUrl - The normalized `.git` repository URL stored in the project config.
 * @param repoRef - The ref stored in the project config (`issue-<n>`, `refs/pull/<n>/head`, …).
 * @returns The source ref identity, or `null` if the project is not tied to an issue or PR/MR.
 *
 * @pure true
 * @invariant ∀(url, ref): result ≠ null → result.number matches /^\d+$/
 * @complexity O(n)
 */
export const parseProjectSourceRef = (
  repoUrl: string,
  repoRef: string
): ProjectSourceRef | null => {
  const ref = repoRef.trim()
  if (ref.length === 0) {
    return null
  }

  const github = parseGithubRepoUrl(repoUrl)
  if (github !== null) {
    const identity = parseGithubRefIdentity(ref)
    return identity === null
      ? null
      : { provider: "github", owner: github.owner, repo: github.repo, kind: identity.kind, number: identity.number }
  }

  const gitlab = parseGitlabRepoUrl(repoUrl)
  if (gitlab !== null) {
    const identity = parseGitlabRefIdentity(ref)
    return identity === null
      ? null
      : {
        provider: "gitlab",
        owner: gitlab.projectPath,
        repo: gitlab.repo,
        kind: identity.kind,
        number: identity.number
      }
  }

  return null
}

export type ProjectSourceState = "open" | "closed" | "unknown"

/**
 * Normalize a raw provider issue/PR state string into a {@link ProjectSourceState}.
 *
 * GitHub returns `open` | `closed`; GitLab returns `opened` | `closed` | `merged` | `locked`.
 * Anything we cannot confidently classify as open or closed becomes `unknown` so that
 * the cautious default (never delete) applies.
 *
 * @pure true
 * @complexity O(1)
 */
export const normalizeProjectSourceState = (
  raw: string | null | undefined
): ProjectSourceState => {
  const value = raw?.trim().toLowerCase() ?? ""
  if (value === "open" || value === "opened") {
    return "open"
  }
  if (value === "closed" || value === "merged" || value === "locked") {
    return "closed"
  }
  return "unknown"
}

/**
 * Decide whether a project should be auto-deleted given its source state.
 *
 * Only a definitively `closed` issue/PR triggers deletion; `open` and `unknown`
 * states are preserved so transient API failures never destroy live work.
 *
 * @pure true
 * @invariant deleteForSourceState(s) → s = "closed"
 * @complexity O(1)
 */
export const shouldDeleteForSourceState = (state: ProjectSourceState): boolean => state === "closed"
