import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { runCommandWithExitCodes } from "../shell/command-runner.js"
import { resolveDockerVolumeHostPath } from "../shell/docker-auth.js"
import { AuthError, CommandFailedError } from "../shell/errors.js"

// CHANGE: run the Grok CLI device-auth flow inside the auth container
// WHY: `docker-git auth grok login` must work from terminal-only containers without callback URL handling
// REF: issue-304
// SOURCE: https://x.ai/news/grok-build-cli
// FORMAT THEOREM: forall cmd: runGrokOauthLogin(cmd) -> device_code_authorized -> grok_credentials_stored | error
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

const printDeviceAuthInstructions = (): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write("\n")
    process.stderr.write("Grok CLI Device Authentication\n")
    process.stderr.write("1. Copy the device code printed by the Grok CLI.\n")
    process.stderr.write("2. Open the verification URL printed by the CLI in a browser.\n")
    process.stderr.write("3. Complete approval; this terminal continues after the CLI writes credentials.\n")
    process.stderr.write("\n")
  })

const grokAuthPermissionScript = [
  "target_uid=\"${CHOWN_UID:-$(stat -c %u \"$1\" 2>/dev/null || id -u)}\"",
  "target_gid=\"${CHOWN_GID:-$(stat -c %g \"$1\" 2>/dev/null || id -g)}\"",
  "chown -R \"$target_uid:$target_gid\" \"$1\"",
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
    Effect.tapError((err) => Effect.logWarning(`Failed to fix Grok auth permissions: ${String(err)}`))
  )

/**
 * Runs the Grok CLI `--device-auth` login inside the docker-git auth container.
 *
 * The CLI prints a device code and verification URL; after the user completes
 * approval externally, the command exits and credentials are normalized.
 *
 * @param cwd Working directory used for Docker command execution.
 * @param accountPath Selected docker-git Grok account directory.
 * @param options Auth container image and in-container home path.
 * @returns Effect that completes after device authorization writes credentials and permissions are normalized.
 * @pure false
 * @effect CommandExecutor; invokes Docker and writes credentials under the selected account path.
 * @invariant successful completion leaves credentials scoped to accountPath and not to project source files.
 * @precondition Docker is available and options.image contains the official Grok CLI binary.
 * @postcondition accountPath ownership follows the mounted account root or a typed error is returned.
 * @complexity O(n) local argument construction plus unbounded external device authorization time.
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
    yield* _(printDeviceAuthInstructions())
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
