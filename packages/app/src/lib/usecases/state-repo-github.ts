import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { CommandFailedError } from "../shell/errors.js"
import { runGhApiCapture, runGhApiNullable } from "./github-api-helpers.js"
import { ensureGhAuthImage, ghAuthRoot } from "./github-auth-image.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"
import { stateInit } from "./state-repo.js"

// CHANGE: ensure .docker-git repository exists on GitHub after auth
// WHY: on auth, automatically create or clone the state repo for synchronized work
// QUOTE(ТЗ): "как только вызываем docker-git auth github то происходит синхронизация. ОН либо создаёт репозиторий .docker-git либо его клонирует к нам"
// REF: issue-141
// SOURCE: https://github.com/skulidropek/.docker-git
// FORMAT THEOREM: ∀token: login(token) → ∃repo: cloned(repo, ~/.docker-git)
// PURITY: SHELL
// EFFECT: Effect<void, never, FileSystem | Path | CommandExecutor>
// INVARIANT: failures are logged but do not abort the auth flow
// COMPLEXITY: O(1) API calls

type GithubStateRepoRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

const dotDockerGitRepoName = ".docker-git"
const defaultStateRef = "main"

// PURITY: SHELL
// INVARIANT: fails if login cannot be resolved
const resolveViewerLogin = (
  cwd: string,
  hostPath: string,
  token: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const raw = yield* _(runGhApiCapture(cwd, hostPath, token, ["/user", "--jq", ".login"]))
    if (raw.length === 0) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "gh api /user --jq .login", exitCode: 1 })))
    }
    return raw
  })

// PURITY: SHELL
// INVARIANT: returns null if repo does not exist (404)
const getRepoCloneUrl = (
  cwd: string,
  hostPath: string,
  token: string,
  login: string
): Effect.Effect<string | null, PlatformError, CommandExecutor.CommandExecutor> =>
  runGhApiNullable(cwd, hostPath, token, [
    `/repos/${login}/${dotDockerGitRepoName}`,
    "--jq",
    ".clone_url"
  ])

// PURITY: SHELL
// INVARIANT: returns null if creation fails
const createStateRepo = (
  cwd: string,
  hostPath: string,
  token: string
): Effect.Effect<string | null, PlatformError, CommandExecutor.CommandExecutor> =>
  runGhApiNullable(cwd, hostPath, token, [
    "-X",
    "POST",
    "/user/repos",
    "-f",
    `name=${dotDockerGitRepoName}`,
    "-f",
    "private=false",
    "-f",
    "auto_init=true",
    "--jq",
    ".clone_url"
  ])

/**
 * Ensures the .docker-git state repository exists on GitHub and is initialised locally.
 *
 * On GitHub auth, immediately:
 * 1. Resolve the authenticated user's login via the GitHub API
 * 2. Check whether `<login>/.docker-git` exists on GitHub
 * 3. If missing, create the repository (public, auto-initialised with a README)
 * 4. Initialise the local `~/.docker-git` directory as a clone of that repository
 *
 * All failures are swallowed and logged as warnings so they never abort the auth
 * flow itself.
 *
 * @param token - A valid GitHub personal-access or OAuth token
 * @returns Effect<void, never, GithubStateRepoRuntime>
 *
 * @pure false
 * @effect FileSystem, CommandExecutor (Docker gh CLI, git)
 * @invariant ∀token ∈ ValidTokens: ensureStateDotDockerGitRepo(token) → cloned(~/.docker-git) ∨ warned
 * @precondition token.length > 0
 * @postcondition ~/.docker-git is a git repo with origin pointing to github.com/<login>/.docker-git
 * @complexity O(1) API calls
 * @throws Never - all errors are caught and logged
 */
export const ensureStateDotDockerGitRepo = (
  token: string
): Effect.Effect<void, never, GithubStateRepoRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      const ghRoot = resolvePathFromCwd(path, cwd, ghAuthRoot)
      yield* _(fs.makeDirectory(ghRoot, { recursive: true }))
      yield* _(ensureGhAuthImage(fs, path, cwd, "gh api"))

      const login = yield* _(resolveViewerLogin(cwd, ghRoot, token))
      let cloneUrl = yield* _(getRepoCloneUrl(cwd, ghRoot, token, login))

      if (cloneUrl === null) {
        yield* _(Effect.log(`Creating .docker-git repository for ${login}...`))
        cloneUrl = yield* _(createStateRepo(cwd, ghRoot, token))
      }

      if (cloneUrl === null) {
        yield* _(Effect.logWarning(`Could not resolve or create .docker-git repository for ${login}`))
        return
      }

      yield* _(Effect.log(`Initializing state repository: ${cloneUrl}`))
      yield* _(stateInit({ repoUrl: cloneUrl, repoRef: defaultStateRef, token }))
    })
  ).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.logWarning(
          `State repo setup failed: ${error instanceof Error ? error.message : String(error)}`
        ),
      onSuccess: () => Effect.void
    })
  )
