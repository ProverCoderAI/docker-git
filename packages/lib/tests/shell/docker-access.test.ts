import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import { classifyDockerAccessIssue, ensureDockerDaemonAccess } from "../../src/shell/docker.js"

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const makeDockerInfoExecutor = (): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      const last = flattened[flattened.length - 1]!
      const dockerHost = last.env["DOCKER_HOST"]
      const stderrText = dockerHost === undefined
        ? 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.51/info": dial unix /var/run/docker.sock: connect: permission denied'
        : `Cannot connect to the Docker daemon at ${dockerHost}. Is the docker daemon running?`

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(1)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.succeed(encode(stderrText)),
        stdin: Sink.drain,
        stdout: Stream.empty,
        toJSON: () => ({ _tag: "DockerAccessTestProcess" }),
        [Inspectable.NodeInspectSymbol]: () => ({ _tag: "DockerAccessTestProcess" }),
        toString: () => "DockerAccessTestProcess"
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

describe("classifyDockerAccessIssue", () => {
  it("classifies socket permission failures as PermissionDenied", () => {
    const issue = classifyDockerAccessIssue(
      'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.51/info": dial unix /var/run/docker.sock: connect: permission denied'
    )

    expect(issue).toBe("PermissionDenied")
  })

  it("classifies non-permission docker access failures as DaemonUnavailable", () => {
    const issue = classifyDockerAccessIssue(
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
    )

    expect(issue).toBe("DaemonUnavailable")
  })

  it.effect("preserves PermissionDenied when rootless fallback also fails", () =>
    Effect.gen(function*(_) {
      const executor = makeDockerInfoExecutor()
      const previousDockerHost = process.env["DOCKER_HOST"]
      const previousRuntimeDir = process.env["XDG_RUNTIME_DIR"]
      const restoreEnv = Effect.sync(() => {
        if (previousDockerHost === undefined) {
          delete process.env["DOCKER_HOST"]
        } else {
          process.env["DOCKER_HOST"] = previousDockerHost
        }

        if (previousRuntimeDir === undefined) {
          delete process.env["XDG_RUNTIME_DIR"]
        } else {
          process.env["XDG_RUNTIME_DIR"] = previousRuntimeDir
        }
      })

      yield* _(Effect.sync(() => {
        delete process.env["DOCKER_HOST"]
        delete process.env["XDG_RUNTIME_DIR"]
      }))

      const error = yield* _(
        Effect.ensuring(
          Effect.scoped(
            ensureDockerDaemonAccess("/tmp").pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, executor),
              Effect.flip
            )
          )
          ,
          restoreEnv
        )
      )

      expect(error.issue).toBe("PermissionDenied")
      expect(error.details).toContain("/var/run/docker.sock")
      expect(error.details).toContain("Fallback DOCKER_HOST=unix:///run/user/")
    })
  )

  it.effect("does not probe rootless fallbacks when DOCKER_HOST is explicit", () =>
    Effect.gen(function*(_) {
      const executor = makeDockerInfoExecutor()
      const previousDockerHost = process.env["DOCKER_HOST"]
      const restoreEnv = Effect.sync(() => {
        if (previousDockerHost === undefined) {
          delete process.env["DOCKER_HOST"]
        } else {
          process.env["DOCKER_HOST"] = previousDockerHost
        }
      })

      yield* _(Effect.sync(() => {
        process.env["DOCKER_HOST"] = "unix:///explicit-docker.sock"
      }))

      const error = yield* _(
        Effect.ensuring(
          Effect.scoped(
            ensureDockerDaemonAccess("/tmp").pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, executor),
              Effect.flip
            )
          ),
          restoreEnv
        )
      )

      expect(error.issue).toBe("PermissionDenied")
      expect(error.details).not.toContain("Fallback DOCKER_HOST=")
    })
  )
})
