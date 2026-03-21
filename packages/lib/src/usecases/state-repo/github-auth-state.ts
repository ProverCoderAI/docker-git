import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import type { CommandFailedError } from "../../shell/errors.js"
import { git, gitBaseEnv, gitCapture } from "./git-commands.js"
import {
  isGithubHttpsRemote,
  normalizeGithubHttpsRemote,
  requiresGithubAuthHint,
  resolveGithubToken
} from "./github-auth.js"

export const githubAuthLoginHint =
  "GitHub is not authorized for docker-git. To use state sync, run: docker-git auth github login --web"

export const normalizeOriginUrlIfNeeded = (
  root: string,
  originUrl: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const normalized = normalizeGithubHttpsRemote(originUrl)
    if (normalized === null || normalized === originUrl) {
      return originUrl
    }
    yield* _(git(root, ["remote", "set-url", "origin", normalized], gitBaseEnv))
    return normalized
  })

export const resolveStateGithubContext = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<
  { readonly originUrl: string; readonly token: string | null; readonly authHintNeeded: boolean },
  CommandFailedError | PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*(_) {
    const rawOriginUrl = yield* _(
      gitCapture(root, ["remote", "get-url", "origin"], gitBaseEnv).pipe(Effect.map((value) => value.trim()))
    )
    const originUrl = yield* _(normalizeOriginUrlIfNeeded(root, rawOriginUrl))
    const token = yield* _(resolveGithubToken(fs, path, root))
    return {
      originUrl,
      token,
      authHintNeeded: requiresGithubAuthHint(originUrl, token)
    }
  })

export const shouldLogGithubAuthHintForStateSyncFailure = (
  originUrl: string,
  token: string | null,
  error: CommandFailedError | PlatformError
): boolean =>
  requiresGithubAuthHint(originUrl, token) ||
  (isGithubHttpsRemote(originUrl) &&
    error._tag === "CommandFailedError" &&
    error.command === "git fetch origin --prune")

export const withGithubAuthHintOnFailure = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  enabled: boolean
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.tapError(() => enabled ? Effect.logWarning(githubAuthLoginHint) : Effect.void)
  )
