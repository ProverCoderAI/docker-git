import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { CreateCommand } from "../core/domain.js"
import { parseGithubRepoUrl } from "../core/repo.js"
import { runDockerAuthCapture } from "../shell/docker-auth.js"
import { CommandFailedError } from "../shell/errors.js"
import { buildDockerAuthSpec } from "./auth-helpers.js"
import { parseEnvEntries, readEnvText } from "./env-file.js"
import { ensureGhAuthImage, ghAuthDir, ghAuthRoot, ghImageName } from "./github-auth-image.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"

type GithubForkRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

const resolveGithubToken = (envText: string): string | null => {
  const entries = parseEnvEntries(envText)
  const direct = entries.find((entry) => entry.key === "GITHUB_TOKEN" || entry.key === "GH_TOKEN")
  if (direct && direct.value.trim().length > 0) {
    return direct.value.trim()
  }
  const labeled = entries.find((entry) => entry.key.startsWith("GITHUB_TOKEN__"))
  return labeled && labeled.value.trim().length > 0 ? labeled.value.trim() : null
}

const runGhApiCapture = (
  cwd: string,
  hostPath: string,
  token: string,
  args: ReadonlyArray<string>
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuthCapture(
    buildDockerAuthSpec({
      cwd,
      image: ghImageName,
      hostPath,
      containerPath: ghAuthDir,
      env: `GH_TOKEN=${token}`,
      args: ["api", ...args],
      interactive: false
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: `gh api ${args.join(" ")}`, exitCode })
  ).pipe(Effect.map((raw) => raw.trim()))

const runGhApiCloneUrl = (
  cwd: string,
  hostPath: string,
  token: string,
  args: ReadonlyArray<string>
): Effect.Effect<string | null, PlatformError, CommandExecutor.CommandExecutor> =>
  runGhApiCapture(cwd, hostPath, token, args).pipe(
    Effect.catchAll(() => Effect.succeed("")),
    Effect.map((raw) => (raw.length === 0 ? null : raw))
  )

const resolveViewerLogin = (
  cwd: string,
  hostPath: string,
  token: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const command = "gh api /user --jq .login"
    const raw = yield* _(runGhApiCapture(cwd, hostPath, token, ["/user", "--jq", ".login"]))
    if (raw.length === 0) {
      return yield* _(Effect.fail(new CommandFailedError({ command, exitCode: 1 })))
    }
    return raw
  })

const resolveRepoCloneUrl = (
  cwd: string,
  hostPath: string,
  token: string,
  fullName: string
): Effect.Effect<string | null, PlatformError, CommandExecutor.CommandExecutor> =>
  runGhApiCloneUrl(cwd, hostPath, token, [`/repos/${fullName}`, "--jq", ".clone_url"])

const createFork = (
  cwd: string,
  hostPath: string,
  token: string,
  owner: string,
  repo: string
): Effect.Effect<string | null, PlatformError, CommandExecutor.CommandExecutor> =>
  runGhApiCloneUrl(cwd, hostPath, token, [
    "-X",
    "POST",
    `/repos/${owner}/${repo}/forks`,
    "--jq",
    ".clone_url"
  ])

// CHANGE: resolve a fork URL for GitHub repos when a token is available
// WHY: allow docker-git clone to auto-fork issue URLs for push access
// QUOTE(ТЗ): "Сразу на issues и он бы делал форк репы если это надо"
// REF: user-request-2026-02-05-issues-fork
// SOURCE: n/a
// FORMAT THEOREM: ∀r: github(r) ∧ token → fork(r)=url ∨ null
// PURITY: SHELL
// EFFECT: Effect<string | null, PlatformError | CommandFailedError, CommandExecutor>
// INVARIANT: returns null when token or repo parsing is missing
// COMPLEXITY: O(1) API calls
export const resolveGithubForkUrl = (
  repoUrl: string,
  envGlobalPath: string
): Effect.Effect<string | null, PlatformError | CommandFailedError, GithubForkRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      const repo = parseGithubRepoUrl(repoUrl)
      if (!repo) {
        return null
      }
      const envPath = resolvePathFromCwd(path, cwd, envGlobalPath)
      const envText = yield* _(readEnvText(fs, envPath))
      const token = resolveGithubToken(envText)
      if (!token) {
        yield* _(Effect.logWarning("GitHub token missing; skipping auto-fork."))
        return null
      }
      const ghRoot = resolvePathFromCwd(path, cwd, ghAuthRoot)
      yield* _(fs.makeDirectory(ghRoot, { recursive: true }))
      yield* _(ensureGhAuthImage(fs, path, cwd, "gh api"))
      const viewer = yield* _(resolveViewerLogin(cwd, ghRoot, token))
      if (viewer.toLowerCase() === repo.owner.toLowerCase()) {
        return null
      }
      const forkFullName = `${viewer}/${repo.repo}`
      const existingFork = yield* _(resolveRepoCloneUrl(cwd, ghRoot, token, forkFullName))
      if (existingFork !== null) {
        return existingFork
      }
      return yield* _(createFork(cwd, ghRoot, token, repo.owner, repo.repo))
    })
  )

// CHANGE: apply auto-fork URL to create configs when available
// WHY: keep create flow small while enabling fork-aware remotes
// QUOTE(ТЗ): "Сразу на issues и он бы делал форк репы если это надо"
// REF: user-request-2026-02-05-issues-fork
// SOURCE: n/a
// FORMAT THEOREM: ∀c: fork(c) → config(c)=config(c)+forkUrl
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, never, FileSystem | Path | CommandExecutor>
// INVARIANT: failures do not abort project creation
// COMPLEXITY: O(1) API calls
export const applyGithubForkConfig = (
  config: CreateCommand["config"]
): Effect.Effect<CreateCommand["config"], never, GithubForkRuntime> =>
  resolveGithubForkUrl(config.repoUrl, config.envGlobalPath).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.logWarning(
          `Auto-fork failed; continuing without fork. (${error instanceof Error ? error.message : String(error)})`
        ).pipe(Effect.as(config)),
      onSuccess: (forkUrl) => Effect.succeed(forkUrl ? { ...config, forkRepoUrl: forkUrl } : config)
    })
  )
