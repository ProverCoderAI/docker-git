import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import {
  normalizeProjectSourceState,
  type ProjectSourceRef,
  type ProjectSourceState
} from "../core/project-source-ref.js"
import { runGhApiNullable } from "./github-api-helpers.js"

// CHANGE: query the open/closed state of the issue or PR a project was cloned from
// WHY: drive automatic deletion of containers whose issue or PR has already been closed
// QUOTE(ТЗ): "Сделать возможность автоматического удаления контейнера issues или PR которого уже закрылся"
// REF: issue-117
// SOURCE: https://github.com/ProverCoderAI/docker-git/issues/117
// PURITY: SHELL
// EFFECT: Effect<ProjectSourceState, PlatformError, CommandExecutor>
// INVARIANT: never throws on API/HTTP failure — unknown is returned so deletion is skipped
// COMPLEXITY: O(1) API call

/**
 * Fetch the open/closed state of the GitHub issue or pull request behind a project.
 *
 * GitHub's `/repos/{owner}/{repo}/issues/{n}` endpoint resolves both issues and pull
 * requests (a PR is an issue), so a single call covers either kind. Any failure or
 * unrecognised response collapses to `unknown`, which the caller treats as "keep".
 *
 * @pure false
 * @effect CommandExecutor (Docker gh CLI)
 * @invariant ∀ref: result ∈ {open, closed, unknown}
 * @complexity O(1) API call
 */
const fetchGithubSourceState = (
  cwd: string,
  hostPath: string,
  token: string,
  ref: ProjectSourceRef
): Effect.Effect<ProjectSourceState, PlatformError, CommandExecutor.CommandExecutor> =>
  runGhApiNullable(cwd, hostPath, token, [
    `/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`,
    "--jq",
    ".state"
  ]).pipe(Effect.map((raw) => normalizeProjectSourceState(raw)))

/**
 * Resolve the open/closed state of the issue or PR a project originates from.
 *
 * Only GitHub is supported today; GitLab refs resolve to `unknown` so they are never
 * auto-deleted until first-class GitLab support is added.
 *
 * @pure false
 * @effect CommandExecutor (Docker gh CLI)
 * @invariant GitLab refs → unknown
 * @complexity O(1) API call
 */
export const fetchProjectSourceState = (
  cwd: string,
  hostPath: string,
  token: string,
  ref: ProjectSourceRef
): Effect.Effect<ProjectSourceState, PlatformError, CommandExecutor.CommandExecutor> =>
  ref.provider === "github"
    ? fetchGithubSourceState(cwd, hostPath, token, ref)
    : Effect.succeed<ProjectSourceState>("unknown")
