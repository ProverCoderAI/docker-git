export type ProjectTerminalLabelInput = {
  readonly containerName?: string | undefined
  readonly displayName: string
  readonly repoRef: string
  readonly repoUrl: string
}

const issueRefPattern = /^issue-(\d+)$/u
const githubPullRefPattern = /^refs\/pull\/(\d+)\/head$/u
const gitlabMergeRequestRefPattern = /^refs\/merge-requests\/(\d+)\/head$/u

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
  return issueUrl === null ? `issue #${issueId}` : `issue #${issueId} (${issueUrl})`
}

const renderPullRequestContext = (repoUrl: string, pullRequestId: string): string => {
  const pullRequestUrl = sourceUrlForContext(repoUrl, `pull/${pullRequestId}`)
  return pullRequestUrl === null ? `PR #${pullRequestId}` : `PR #${pullRequestId} (${pullRequestUrl})`
}

const renderMergeRequestContext = (mergeRequestId: string): string => `MR #${mergeRequestId}`

const renderSourceContext = (repoUrl: string, repoRef: string): string => {
  const trimmedRef = repoRef.trim()
  return trimmedRef.length === 0 || trimmedRef === "main"
    ? `source ${repoUrl.trim()}`
    : `source ${repoUrl.trim()} (${trimmedRef})`
}

const renderWorkspaceContext = (
  repoUrl: string,
  repoRef: string
): string => {
  const issueMatch = issueRefPattern.exec(repoRef)
  if (issueMatch !== null) {
    const issueId = issueMatch[1]
    return issueId === undefined ? renderSourceContext(repoUrl, repoRef) : renderIssueContext(repoUrl, issueId)
  }
  const pullMatch = githubPullRefPattern.exec(repoRef)
  if (pullMatch !== null) {
    const pullRequestId = pullMatch[1]
    return pullRequestId === undefined
      ? renderSourceContext(repoUrl, repoRef)
      : renderPullRequestContext(repoUrl, pullRequestId)
  }
  const mergeRequestMatch = gitlabMergeRequestRefPattern.exec(repoRef)
  if (mergeRequestMatch !== null) {
    const mergeRequestId = mergeRequestMatch[1]
    return mergeRequestId === undefined
      ? renderSourceContext(repoUrl, repoRef)
      : renderMergeRequestContext(mergeRequestId)
  }
  return renderSourceContext(repoUrl, repoRef)
}

const appendNonEmpty = (parts: ReadonlyArray<string>, value: string): ReadonlyArray<string> => {
  const trimmed = value.trim()
  return trimmed.length === 0 ? parts : [...parts, trimmed]
}

/**
 * Builds the terminal-facing project label with source workspace context.
 *
 * @param project - Project identity returned by the docker-git API.
 * @returns A deterministic label for SSH terminal headers and ready messages.
 *
 * @pure true
 * @effect none
 * @invariant issue refs include an issue marker; PR refs include a PR marker; labels never omit displayName.
 * @precondition project.displayName identifies the repository or fallback project label.
 * @postcondition result contains displayName, workspace source context, and non-empty containerName when present.
 * @complexity O(n) where n = |repoUrl| + |repoRef|
 * @throws Never
 */
// CHANGE: surface clone-source context in SSH terminal labels
// WHY: terminal headers must identify issue/PR source and container instead of only the repo path
// QUOTE(ТЗ): "надо писать какой Issues какой PR вообещ что за конетейнер"
// REF: issue-370
// SOURCE: n/a
// FORMAT THEOREM: forall p: label(p) contains displayName(p) and context(repoUrl(p), repoRef(p))
// PURITY: CORE
// EFFECT: none
// INVARIANT: issue-* -> issue context; refs/pull/*/head -> PR context; containerName is preserved when non-empty
// COMPLEXITY: O(n)
export const projectTerminalLabel = (project: ProjectTerminalLabelInput): string => {
  const displayName = project.displayName.trim()
  const baseName = displayName.length === 0 ? project.repoUrl.trim() : displayName
  const withContext = appendNonEmpty([baseName], renderWorkspaceContext(project.repoUrl, project.repoRef))
  const containerName = project.containerName?.trim() ?? ""
  const withContainer = containerName.length === 0
    ? withContext
    : appendNonEmpty(withContext, `container ${containerName}`)
  return withContainer.join(" | ")
}
