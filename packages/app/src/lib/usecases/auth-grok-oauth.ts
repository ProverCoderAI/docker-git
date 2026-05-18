import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { runCommandWithExitCodes } from "../shell/command-runner.js"
import { resolveDockerVolumeHostPath } from "../shell/docker-auth.js"
import { AuthError, CommandFailedError } from "../shell/errors.js"

// CHANGE: add Grok CLI OAuth/browser authentication flow
// WHY: issue #304 expects `grok login` style URL handoff and callback paste support
// QUOTE(ТЗ): "Paste the URL here if it doesn't connect"
// REF: issue-304
// SOURCE: https://x.ai/news/grok-build-cli
// FORMAT THEOREM: forall cmd: runGrokOauthLogin(cmd) -> grok_credentials_stored | error
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: Grok credentials are stored in ~/.grok within the selected account path
// COMPLEXITY: O(user_interaction)

type DockerGrokAuthSpec = {
  readonly cwd: string
  readonly image: string
  readonly hostPath: string
  readonly containerPath: string
  readonly env: ReadonlyArray<string>
}

const buildDockerGrokAuthSpec = (
  cwd: string,
  accountPath: string,
  image: string,
  containerPath: string
): DockerGrokAuthSpec => ({
  cwd,
  image,
  hostPath: accountPath,
  containerPath,
  env: [
    `HOME=${containerPath}`,
    "MCP_PLAYWRIGHT_ISOLATED=1"
  ]
})

/**
 * Builds the Docker CLI argument vector for the official Grok device-code login flow.
 *
 * @param spec Docker auth container paths, image, working directory, and environment bindings.
 * @returns Immutable Docker argument vector ending with `grok login --device-auth`.
 * @pure true
 * @effect none; CORE argument builder only transforms immutable input data.
 * @invariant every non-empty environment binding is emitted as an adjacent `-e` argument pair.
 * @precondition spec.hostPath and spec.containerPath identify the selected Grok auth account directory.
 * @postcondition returned args execute the official headless Grok login mode documented by xAI.
 * @complexity O(n) time / O(n) space, where n is spec.env.length.
 * @throws Never - invalid process execution is represented by callers through typed Effect errors.
 */
export const buildDockerGrokAuthArgs = (spec: DockerGrokAuthSpec): ReadonlyArray<string> => {
  const base: Array<string> = [
    "run",
    "--rm",
    "--init",
    "-i",
    "-t",
    "-v",
    `${spec.hostPath}:${spec.containerPath}`,
    "-w",
    spec.containerPath
  ]

  for (const entry of spec.env) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) {
      continue
    }
    base.push("-e", trimmed)
  }
  return [...base, spec.image, "grok", "login", "--device-auth"]
}

const printOauthInstructions = (): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write("\n")
    process.stderr.write("Grok CLI OAuth Authentication\n")
    process.stderr.write("1. Open the Grok sign-in URL printed by the CLI.\n")
    process.stderr.write("2. Complete browser authentication.\n")
    process.stderr.write("3. If the callback cannot connect, paste the returned URL into the prompt.\n")
    process.stderr.write("\n")
  })

const grokAuthPermissionScript = [
  "chown -R 1000:1000 \"$1\"",
  "find \"$1\" -type d -exec chmod 700 {} +",
  "find \"$1\" -type f -exec chmod 600 {} +"
].join(" && ")

const fixGrokAuthPermissions = (cwd: string, hostPath: string, containerPath: string) =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: [
        "run",
        "--rm",
        "-v",
        `${hostPath}:${containerPath}`,
        "alpine",
        "sh",
        "-c",
        grokAuthPermissionScript,
        "sh",
        containerPath
      ]
    },
    [0],
    (exitCode) => new CommandFailedError({ command: "chmod grok auth", exitCode })
  ).pipe(
    Effect.tapError((err) => Effect.logWarning(`Failed to fix Grok auth permissions: ${String(err)}`)),
    Effect.orElse(() => Effect.void)
  )

/**
 * Runs the Grok OAuth device login inside the docker-git auth container.
 *
 * @param cwd Working directory used for Docker command execution.
 * @param accountPath Selected docker-git Grok account directory.
 * @param options Auth container image and in-container home path.
 * @returns Effect that completes after Grok writes credentials and permissions are normalized.
 * @pure false
 * @effect CommandExecutor; invokes Docker and writes credentials under the selected account path.
 * @invariant successful completion leaves credentials scoped to accountPath and not to project source files.
 * @precondition Docker is available and options.image contains the official Grok CLI binary.
 * @postcondition accountPath permissions are best-effort normalized for the project SSH user.
 * @complexity O(n) local argument construction plus unbounded external OAuth interaction time.
 * @throws Never - failures are modeled as AuthError, CommandFailedError, or PlatformError in the Effect type.
 */
export const runGrokOauthLoginWithPrompt = (
  cwd: string,
  accountPath: string,
  options: {
    readonly image: string
    readonly containerPath: string
  }
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(printOauthInstructions())
    const hostPath = yield* _(resolveDockerVolumeHostPath(cwd, accountPath))
    const spec = buildDockerGrokAuthSpec(cwd, hostPath, options.image, options.containerPath)
    yield* _(
      runCommandWithExitCodes(
        {
          cwd: spec.cwd,
          command: "docker",
          args: buildDockerGrokAuthArgs(spec)
        },
        [0],
        (exitCode) =>
          new AuthError({
            message: `Grok CLI login failed with exit code ${exitCode}.`
          })
      )
    )
    yield* _(fixGrokAuthPermissions(spec.cwd, hostPath, spec.containerPath))
  })
