import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"
import type { CommandFailedError } from "../../shell/errors.js"
import { defaultProjectsRoot } from "../menu-helpers.js"
import { git, gitBaseEnv, gitCapture, gitExitCode, successExitCode } from "./git-commands.js"
import { resolveStateGithubContext, withGithubAuthHintOnFailure } from "./github-auth-state.js"
import { isGithubHttpsRemote, withGithubAskpassEnv } from "./github-auth.js"

const resolveStateRoot = (path: Path.Path, cwd: string): string => path.resolve(defaultProjectsRoot(cwd))

export const statePull: Effect.Effect<
  void,
  CommandFailedError | PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> = Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  const originUrlExit = yield* _(gitExitCode(root, ["remote", "get-url", "origin"], gitBaseEnv))
  if (originUrlExit !== successExitCode) {
    yield* _(git(root, ["pull", "--rebase"], gitBaseEnv))
    return
  }
  const auth = yield* _(resolveStateGithubContext(fs, path, root))
  const effect = auth.token && auth.token.length > 0 && isGithubHttpsRemote(auth.originUrl)
    ? withGithubAskpassEnv(auth.token, (env) => git(root, ["pull", "--rebase"], env))
    : git(root, ["pull", "--rebase"], gitBaseEnv)
  yield* _(withGithubAuthHintOnFailure(effect, auth.authHintNeeded))
}).pipe(Effect.asVoid)

export const statePush: Effect.Effect<
  void,
  CommandFailedError | PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> = Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  const originUrlExit = yield* _(gitExitCode(root, ["remote", "get-url", "origin"], gitBaseEnv))
  if (originUrlExit !== successExitCode) {
    yield* _(git(root, ["push", "-u", "origin", "HEAD"], gitBaseEnv))
    return
  }
  const auth = yield* _(resolveStateGithubContext(fs, path, root))
  const effect = auth.token && auth.token.length > 0 && isGithubHttpsRemote(auth.originUrl)
    ? withGithubAskpassEnv(
      auth.token,
      (env) =>
        pipe(
          gitCapture(root, ["rev-parse", "--abbrev-ref", "HEAD"], env),
          Effect.map((value) => value.trim()),
          Effect.map((branch) => (branch === "HEAD" ? "main" : branch)),
          Effect.flatMap((branch) =>
            git(root, ["push", "--no-verify", auth.originUrl, `HEAD:refs/heads/${branch}`], env)
          )
        )
    )
    : git(root, ["push", "--no-verify", "-u", "origin", "HEAD"], gitBaseEnv)
  yield* _(withGithubAuthHintOnFailure(effect, auth.authHintNeeded))
}).pipe(Effect.asVoid)
