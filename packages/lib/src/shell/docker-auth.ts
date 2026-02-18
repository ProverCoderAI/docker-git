import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { Effect } from "effect"

import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "./command-runner.js"

export type DockerVolume = {
  readonly hostPath: string
  readonly containerPath: string
}

export type DockerAuthSpec = {
  readonly cwd: string
  readonly image: string
  readonly volume: DockerVolume
  readonly entrypoint?: string
  readonly env?: string | ReadonlyArray<string>
  readonly args: ReadonlyArray<string>
  readonly interactive: boolean
}

const appendEnvArgs = (base: Array<string>, env: string | ReadonlyArray<string>) => {
  if (typeof env === "string") {
    const trimmed = env.trim()
    if (trimmed.length > 0) {
      base.push("-e", trimmed)
    }
    return
  }
  for (const entry of env) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) {
      continue
    }
    base.push("-e", trimmed)
  }
}

const buildDockerArgs = (spec: DockerAuthSpec): ReadonlyArray<string> => {
  const base: Array<string> = ["run", "--rm"]
  if (spec.interactive) {
    base.push("-it")
  }
  if (spec.entrypoint && spec.entrypoint.length > 0) {
    base.push("--entrypoint", spec.entrypoint)
  }
  base.push("-v", `${spec.volume.hostPath}:${spec.volume.containerPath}`)
  if (spec.env !== undefined) {
    appendEnvArgs(base, spec.env)
  }
  return [...base, spec.image, ...spec.args]
}

// CHANGE: expose docker CLI args builder for advanced auth flows (stdin piping)
// WHY: some OAuth CLIs (Claude Code) don't reliably render their input UI; docker-git needs to drive stdin explicitly
// REF: issue-61
// SOURCE: n/a
// PURITY: CORE
// INVARIANT: args match those used by runDockerAuth / runDockerAuthCapture
export const buildDockerAuthArgs = (spec: DockerAuthSpec): ReadonlyArray<string> => buildDockerArgs(spec)

// CHANGE: run a docker auth command with controlled exit codes
// WHY: reuse container auth flow for gh/codex
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exitCode(cmd) in ok -> success
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | E, CommandExecutor>
// INVARIANT: container is removed after execution
// COMPLEXITY: O(command)
export const runDockerAuth = <E>(
  spec: DockerAuthSpec,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<void, E | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    { cwd: spec.cwd, command: "docker", args: buildDockerArgs(spec) },
    okExitCodes,
    onFailure
  )

// CHANGE: run a docker auth command and capture stdout
// WHY: obtain tokens from container auth flows
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: capture(cmd) -> stdout
// PURITY: SHELL
// EFFECT: Effect<string, PlatformError | E, CommandExecutor>
// INVARIANT: container is removed after execution
// COMPLEXITY: O(command)
export const runDockerAuthCapture = <E>(
  spec: DockerAuthSpec,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<string, E | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    { cwd: spec.cwd, command: "docker", args: buildDockerArgs(spec) },
    okExitCodes,
    onFailure
  )

// CHANGE: run a docker auth command and return the exit code
// WHY: allow status checks without throwing
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exitCode(cmd) = n
// PURITY: SHELL
// EFFECT: Effect<number, PlatformError, CommandExecutor>
// INVARIANT: container is removed after execution
// COMPLEXITY: O(command)
export const runDockerAuthExitCode = (
  spec: DockerAuthSpec
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({ cwd: spec.cwd, command: "docker", args: buildDockerArgs(spec) })
