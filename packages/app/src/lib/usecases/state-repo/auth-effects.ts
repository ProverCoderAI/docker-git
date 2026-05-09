/* jscpd:ignore-start */
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import type { CommandFailedError } from "../../shell/errors.js"
import { git, gitBaseEnv } from "./git-commands.js"
import type { GitAuthEnv } from "./github-auth.js"
import { isGithubHttpsRemote, withGithubAskpassEnv } from "./github-auth.js"
import { isGitlabHttpsRemote, resolveGitlabToken, withGitlabAskpassEnv } from "./gitlab-auth.js"
import { runStateSyncOps, runStateSyncWithGitlabToken, runStateSyncWithToken } from "./sync-ops.js"

type StateRepoEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
type StateEffect = Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv>

const hasToken = (token: string | null): token is string => token !== null && token.length > 0

export const resolveGitlabTokenForOrigin = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  originUrl: string
): Effect.Effect<string | null, PlatformError> =>
  isGitlabHttpsRemote(originUrl) ? resolveGitlabToken(fs, path, root) : Effect.succeed(null)

export const selectStateSyncEffect = (
  root: string,
  originUrl: string,
  message: string | null,
  githubToken: string | null,
  gitlabToken: string | null
): StateEffect => {
  if (hasToken(githubToken) && isGithubHttpsRemote(originUrl)) {
    return runStateSyncWithToken(githubToken, root, originUrl, message)
  }
  if (hasToken(gitlabToken)) {
    return runStateSyncWithGitlabToken(gitlabToken, root, originUrl, message)
  }
  return runStateSyncOps(root, originUrl, message, gitBaseEnv)
}

export const selectStatePullEffect = (
  root: string,
  originUrl: string,
  branch: string,
  githubToken: string | null,
  gitlabToken: string | null
): StateEffect => {
  if (hasToken(githubToken) && isGithubHttpsRemote(originUrl)) {
    return withGithubAskpassEnv(githubToken, (env) => git(root, ["pull", "--rebase", "origin", branch], env))
  }
  if (hasToken(gitlabToken)) {
    return withGitlabAskpassEnv(gitlabToken, (env) => git(root, ["pull", "--rebase", "origin", branch], env))
  }
  return git(root, ["pull", "--rebase", "origin", branch], gitBaseEnv)
}

export const selectStateInitEffect = (
  repoUrl: string,
  token: string,
  doInit: (env: GitAuthEnv) => StateEffect
): StateEffect => {
  if (token.length > 0 && isGithubHttpsRemote(repoUrl)) {
    return withGithubAskpassEnv(token, doInit)
  }
  if (token.length > 0 && isGitlabHttpsRemote(repoUrl)) {
    return withGitlabAskpassEnv(token, doInit)
  }
  return doInit(gitBaseEnv)
}
/* jscpd:ignore-end */
