import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import type { CommandFailedError } from "../../shell/errors.js"
import { defaultProjectsRoot } from "../menu-helpers.js"
import { git, gitBaseEnv, gitCapture, gitExitCode, successExitCode } from "./git-commands.js"
import { ensureStateGitignore } from "./gitignore.js"

type StateRepoEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

const resolveStateRoot = (path: Path.Path, cwd: string): string => path.resolve(defaultProjectsRoot(cwd))

const managedRepositoryCachePaths: ReadonlyArray<string> = [".cache/git-mirrors", ".cache/packages"]

const ensureStateIgnoreAndUntrackCaches = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    yield* _(ensureStateGitignore(fs, path, root))
    yield* _(git(root, ["rm", "-r", "--cached", "--ignore-unmatch", ...managedRepositoryCachePaths], gitBaseEnv))
  }).pipe(Effect.asVoid)

export const stateStatus = Effect.gen(function*(_) {
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  const output = yield* _(gitCapture(root, ["status", "-sb", "--porcelain=v1"], gitBaseEnv))
  yield* _(Effect.log(output.trim().length > 0 ? output.trimEnd() : "(clean)"))
}).pipe(Effect.asVoid)

export const stateCommit = (
  message: string
): Effect.Effect<
  void,
  CommandFailedError | PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, process.cwd())
    yield* _(ensureStateIgnoreAndUntrackCaches(fs, path, root))
    yield* _(git(root, ["add", "-A"], gitBaseEnv))
    const diffExit = yield* _(gitExitCode(root, ["diff", "--cached", "--quiet"], gitBaseEnv))
    if (diffExit === successExitCode) {
      yield* _(Effect.log("Nothing to commit."))
      return
    }
    yield* _(git(root, ["commit", "-m", message], gitBaseEnv))
  }).pipe(Effect.asVoid)
