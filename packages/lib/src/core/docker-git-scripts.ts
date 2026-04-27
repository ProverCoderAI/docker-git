// CHANGE: define the set of docker-git scripts to embed in generated containers
// WHY: scripts (pre-commit guards, knowledge splitter) must be available
//      inside containers for git hooks and docker-git module usage
// REF: issue-176
// SOURCE: n/a
// FORMAT THEOREM: ∀ name ∈ dockerGitScriptNames: name ∈ scripts/ ∧ referenced_by_hooks(name)
// PURITY: CORE (pure constant definition)
// INVARIANT: list is exhaustive for all scripts referenced by generated git hooks
// COMPLEXITY: O(1)

/**
 * Names of docker-git scripts that must be available inside generated containers.
 *
 * These scripts are referenced by git hooks (pre-push, pre-commit). They are copied into
 * each project's build context under
 * `scripts/` and embedded into the Docker image at `/opt/docker-git/scripts/`.
 *
 * @pure true
 * @invariant ∀ name ∈ result: ∃ file(scripts/{name}) in docker-git workspace
 */
export const dockerGitScriptNames: ReadonlyArray<string> = [
  "pre-commit-secret-guard.sh",
  "pre-push-knowledge-guard.js",
  "split-knowledge-large-files.js",
  "repair-knowledge-history.js",
  "setup-pre-commit-hook.js"
]
