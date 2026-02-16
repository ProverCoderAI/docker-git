import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

type DockerGitConfigSearchState = {
  readonly stack: Array<string>
  readonly results: Array<string>
}

const isDockerGitConfig = (entry: string): boolean => entry.endsWith("docker-git.json")

const shouldSkipDir = (entry: string): boolean => entry === ".git" || entry === ".orch" || entry === ".docker-git"

const processDockerGitEntry = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
  entry: string,
  state: DockerGitConfigSearchState
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    if (shouldSkipDir(entry)) {
      return
    }

    const resolved = path.join(dir, entry)
    const info = yield* _(fs.stat(resolved))
    if (info.type === "Directory") {
      state.stack.push(resolved)
      return
    }

    if (info.type === "File" && isDockerGitConfig(entry)) {
      state.results.push(resolved)
    }
  }).pipe(Effect.asVoid)

export const findDockerGitConfigPaths = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  rootDir: string
): Effect.Effect<ReadonlyArray<string>, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(rootDir))
    if (!exists) {
      return []
    }

    // Avoid traversing git metadata (projectsRoot can itself be a git repo).
    const results: Array<string> = []
    const stack: Array<string> = [rootDir]
    const state: DockerGitConfigSearchState = { stack, results }
    while (stack.length > 0) {
      const dir = stack.pop()
      if (dir === undefined) {
        break
      }

      const entries = yield* _(fs.readDirectory(dir))
      for (const entry of entries) {
        yield* _(processDockerGitEntry(fs, path, dir, entry, state))
      }
    }

    return results
  })
