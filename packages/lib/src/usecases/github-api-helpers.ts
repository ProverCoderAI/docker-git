import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { runDockerAuthCapture } from "../shell/docker-auth.js"
import { CommandFailedError } from "../shell/errors.js"
import { buildDockerAuthSpec } from "./auth-helpers.js"
import { ghAuthDir, ghImageName } from "./github-auth-image.js"

// CHANGE: extract shared gh-API Docker helpers used by github-fork and state-repo-github
// WHY: avoid code duplication flagged by the duplicate-detection linter
// REF: issue-141
// PURITY: SHELL
// INVARIANT: helpers are stateless and composable

/**
 * Run `gh api <args>` inside the auth Docker container and return trimmed stdout.
 *
 * @pure false
 * @effect CommandExecutor (Docker)
 * @invariant exits with CommandFailedError on non-zero exit code
 * @complexity O(1)
 */
export const runGhApiCapture = (
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

/**
 * Like `runGhApiCapture` but returns `null` instead of failing on API errors
 * (e.g. HTTP 404 / non-zero exit code).
 *
 * @pure false
 * @effect CommandExecutor (Docker)
 * @invariant never fails — errors become null
 * @complexity O(1)
 */
export const runGhApiNullable = (
  cwd: string,
  hostPath: string,
  token: string,
  args: ReadonlyArray<string>
): Effect.Effect<string | null, PlatformError, CommandExecutor.CommandExecutor> =>
  runGhApiCapture(cwd, hostPath, token, args).pipe(
    Effect.catchTag("CommandFailedError", () => Effect.succeed("")),
    Effect.map((raw) => (raw.length === 0 ? null : raw))
  )
