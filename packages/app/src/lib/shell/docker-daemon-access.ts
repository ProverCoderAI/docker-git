import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"
import * as Chunk from "effect/Chunk"
import * as Stream from "effect/Stream"

import { DockerAccessError, type DockerAccessIssue } from "./errors.js"

const permissionDeniedPattern = /permission denied/i

const collectUint8Array = (chunks: Chunk.Chunk<Uint8Array>): Uint8Array =>
  Chunk.reduce(chunks, new Uint8Array(), (acc, curr) => {
    const next = new Uint8Array(acc.length + curr.length)
    next.set(acc)
    next.set(curr, acc.length)
    return next
  })

const resolveDockerHostFallbackCandidates = (): ReadonlyArray<string> => {
  if (process.env["DOCKER_HOST"] !== undefined) {
    return []
  }

  const runtimeDir = process.env["XDG_RUNTIME_DIR"]?.trim()
  const uid = typeof process.getuid === "function"
    ? process.getuid().toString()
    : process.env["UID"]?.trim()

  return [
    ...new Set(
      [
        runtimeDir ? `unix://${runtimeDir}/docker.sock` : undefined,
        uid ? `unix:///run/user/${uid}/docker.sock` : undefined
      ].filter((value): value is string => value !== undefined)
    )
  ]
}

const runDockerInfoCommand = (
  cwd: string,
  env?: Readonly<Record<string, string | undefined>>
): Effect.Effect<
  { readonly exitCode: number; readonly details: string },
  PlatformError,
  CommandExecutor.CommandExecutor
> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const process = yield* _(
        executor.start(
          pipe(
            Command.make("docker", "info"),
            Command.workingDirectory(cwd),
            env ? Command.env(env) : (value) => value,
            Command.stdin("pipe"),
            Command.stdout("pipe"),
            Command.stderr("pipe")
          )
        )
      )

      const stderrBytes = yield* _(
        pipe(process.stderr, Stream.runCollect, Effect.map((chunks) => collectUint8Array(chunks)))
      )
      const exitCode = Number(yield* _(process.exitCode))
      const stderr = new TextDecoder("utf-8").decode(stderrBytes).trim()
      return {
        exitCode,
        details: stderr.length > 0 ? stderr : `docker info failed with exit code ${exitCode}`
      }
    })
  )

// CHANGE: classify docker daemon access failure into deterministic typed reasons
// WHY: allow callers to render actionable recovery guidance for socket permission issues
// QUOTE(ТЗ): "docker-git handles Docker socket permission problems predictably"
// REF: issue-11
// SOURCE: n/a
// FORMAT THEOREM: ∀m: classify(m) ∈ {"PermissionDenied","DaemonUnavailable"}
// PURITY: CORE
// EFFECT: Effect<DockerAccessIssue, never, never>
// INVARIANT: classification is stable for equal input
// COMPLEXITY: O(|m|)
export const classifyDockerAccessIssue = (message: string): DockerAccessIssue =>
  permissionDeniedPattern.test(message) ? "PermissionDenied" : "DaemonUnavailable"

// CHANGE: verify docker daemon access before compose/auth flows
// WHY: fail fast on socket permission errors instead of cascading into opaque command failures
// QUOTE(ТЗ): "permission denied to /var/run/docker.sock"
// REF: issue-11
// SOURCE: n/a
// FORMAT THEOREM: ∀cwd: access(cwd)=ok ∨ DockerAccessError
// PURITY: SHELL
// EFFECT: Effect<void, DockerAccessError | PlatformError, CommandExecutor>
// INVARIANT: non-zero docker info exit always maps to DockerAccessError
// COMPLEXITY: O(command)
export const ensureDockerDaemonAccess = (
  cwd: string
): Effect.Effect<void, DockerAccessError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const primaryResult = yield* _(runDockerInfoCommand(cwd))
      if (primaryResult.exitCode === 0) {
        return
      }

      const primaryIssue = classifyDockerAccessIssue(primaryResult.details)
      if (primaryIssue !== "PermissionDenied") {
        return yield* _(
          Effect.fail(
            new DockerAccessError({
              issue: primaryIssue,
              details: primaryResult.details
            })
          )
        )
      }

      let fallbackErrorDetails = primaryResult.details
      let fallbackIssue: DockerAccessIssue = primaryIssue

      for (const fallbackHost of resolveDockerHostFallbackCandidates()) {
        const fallbackResult = yield* _(
          runDockerInfoCommand(cwd, {
            ...process.env,
            DOCKER_HOST: fallbackHost
          })
        )

        if (fallbackResult.exitCode === 0) {
          process.env["DOCKER_HOST"] = fallbackHost
          return
        }

        fallbackErrorDetails = fallbackResult.details
        fallbackIssue = classifyDockerAccessIssue(fallbackResult.details)
      }

      return yield* _(
        Effect.fail(
          new DockerAccessError({
            issue: fallbackIssue,
            details: fallbackErrorDetails
          })
        )
      )
    })
  )
