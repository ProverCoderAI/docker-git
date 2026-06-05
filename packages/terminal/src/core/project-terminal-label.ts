export type ProjectTerminalLabelInput = {
  readonly containerName?: string | undefined
  readonly displayName: string
  readonly repoRef: string
  readonly repoUrl: string
}

const decimalDigitsPattern = /^\d+$/u

const stripGitSuffix = (value: string): string => value.endsWith(".git") ? value.slice(0, -4) : value

const readPathPart = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

const splitGitHubRemotePath = (repoUrl: string): ReadonlyArray<string> | null => {
  const trimmed = repoUrl.trim()
  const httpsPrefix = "https://github.com/"
  const sshUrlPrefix = "ssh://git@github.com/"
  const sshScpPrefix = "git@github.com:"
  if (trimmed.startsWith(httpsPrefix)) {
    return trimmed.slice(httpsPrefix.length).split("/").filter((part) => part.length > 0)
  }
  if (trimmed.startsWith(sshUrlPrefix)) {
    return trimmed.slice(sshUrlPrefix.length).split("/").filter((part) => part.length > 0)
  }
  if (trimmed.startsWith(sshScpPrefix)) {
    return trimmed.slice(sshScpPrefix.length).split("/").filter((part) => part.length > 0)
  }
  return null
}

const githubRepositoryPath = (repoUrl: string): string | null => {
  const parts = splitGitHubRemotePath(repoUrl)
  const owner = readPathPart(parts?.[0])
  const repoRaw = readPathPart(parts?.[1])
  if (owner === null || repoRaw === null) {
    return null
  }
  return `${owner}/${stripGitSuffix(repoRaw)}`
}

const sourceUrlForContext = (repoUrl: string, path: string): string | null => {
  const repoPath = githubRepositoryPath(repoUrl)
  return repoPath === null ? null : `https://github.com/${repoPath}/${path}`
}

const renderIssueContext = (repoUrl: string, issueId: string): string => {
  const issueUrl = sourceUrlForContext(repoUrl, `issues/${issueId}`)
  return issueUrl === null ? `issue #${issueId}` : issueUrl
}

const renderPullRequestContext = (repoUrl: string, pullRequestId: string): string => {
  const pullRequestUrl = sourceUrlForContext(repoUrl, `pull/${pullRequestId}`)
  return pullRequestUrl === null ? `PR #${pullRequestId}` : pullRequestUrl
}

const renderMergeRequestContext = (mergeRequestId: string): string => `MR #${mergeRequestId}`

const renderSourceContext = (repoUrl: string, repoRef: string): string => {
  const trimmedUrl = repoUrl.trim()
  const trimmedRef = repoRef.trim()
  if (trimmedUrl.length === 0) {
    return trimmedRef.length === 0 || trimmedRef === "main" ? "" : trimmedRef
  }
  return trimmedRef.length === 0 || trimmedRef === "main"
    ? trimmedUrl
    : `${trimmedUrl} (${trimmedRef})`
}

const parseWrappedNumericRef = (value: string, prefix: string, suffix: string): string | null => {
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return null
  }
  const id = value.slice(prefix.length, value.length - suffix.length)
  return decimalDigitsPattern.test(id) ? id : null
}

const renderWorkspaceContext = (
  repoUrl: string,
  repoRef: string
): string => {
  const issueId = parseWrappedNumericRef(repoRef, "issue-", "")
  if (issueId !== null) {
    return renderIssueContext(repoUrl, issueId)
  }
  const pullRequestId = parseWrappedNumericRef(repoRef, "refs/pull/", "/head")
  if (pullRequestId !== null) {
    return renderPullRequestContext(repoUrl, pullRequestId)
  }
  const mergeRequestId = parseWrappedNumericRef(repoRef, "refs/merge-requests/", "/head")
  if (mergeRequestId !== null) {
    return renderMergeRequestContext(mergeRequestId)
  }
  return renderSourceContext(repoUrl, repoRef)
}

const appendNonEmpty = (parts: ReadonlyArray<string>, value: string): ReadonlyArray<string> => {
  const trimmed = value.trim()
  return trimmed.length === 0 ? parts : [...parts, trimmed]
}

/**
 * Builds the terminal-facing project label with source link and container identity.
 *
 * @param project - Project identity returned by the docker-git API.
 * @returns A deterministic label for SSH terminal headers and ready messages.
 *
 * @pure true
 * @effect none
 * @invariant GitHub issue/PR refs prefer canonical source URLs; labels preserve non-empty containerName.
 * @precondition project.displayName identifies the repository or fallback project label.
 * @postcondition result contains workspace source link/context and non-empty containerName when present.
 * @complexity O(n) where n = |repoUrl| + |repoRef|
 * @throws Never
 */
// CHANGE: keep SSH terminal labels to source link/context plus container identity
// WHY: verbose repository + issue text duplicates the source URL and crowds the terminal header
// QUOTE(ТЗ): "ссылки и название контейнера будет предостаточно"
// REF: issue-370
// SOURCE: n/a
// FORMAT THEOREM: forall p: label(p) contains context(repoUrl(p), repoRef(p)) or containerName(p)
// PURITY: CORE
// EFFECT: none
// INVARIANT: issue-* -> issue context; refs/pull/*/head -> PR context; containerName is preserved when non-empty
// COMPLEXITY: O(n)
export const projectTerminalLabel = (project: ProjectTerminalLabelInput): string => {
  const withContext = appendNonEmpty([], renderWorkspaceContext(project.repoUrl, project.repoRef))
  const containerName = project.containerName?.trim() ?? ""
  const withContainer = containerName.length === 0
    ? withContext
    : appendNonEmpty(withContext, `container ${containerName}`)
  if (withContainer.length > 0) {
    return withContainer.join(" | ")
  }
  const displayName = project.displayName.trim()
  return displayName.length === 0 ? project.repoUrl.trim() : displayName
}
