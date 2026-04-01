import { FetchHttpClient, HttpClient } from "@effect/platform"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { Duration, Effect, pipe, Schedule } from "effect"
import { existsSync } from "node:fs"
import path from "node:path"

import { runCommandExitCode } from "@lib/shell/command-runner"

import type { ControllerBootstrapError } from "./host-errors.js"

const defaultApiPort = "3334"
const defaultApiHost = "127.0.0.1"

const trimTrailingSlashes = (value: string): string => {
  const parts = value.split("/")
  let end = parts.length

  while (end > 0 && parts[end - 1] === "") {
    end -= 1
  }

  return end === parts.length ? value : parts.slice(0, end).join("/")
}

export const resolveApiBaseUrl = (): string => {
  const explicit = process.env["DOCKER_GIT_API_URL"]?.trim()
  if (explicit !== undefined && explicit.length > 0) {
    return trimTrailingSlashes(explicit)
  }

  const host = process.env["DOCKER_GIT_API_BIND_HOST"]?.trim() || defaultApiHost
  const port = process.env["DOCKER_GIT_API_PORT"]?.trim() || defaultApiPort
  return `http://${host}:${port}`
}

const composeFilePath = (): string => {
  let current = process.cwd()

  for (;;) {
    const candidate = path.join(current, "docker-compose.yml")
    if (existsSync(candidate)) {
      return candidate
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return path.resolve(process.cwd(), "docker-compose.yml")
    }
    current = parent
  }
}

const runExitCode = (
  command: string,
  args: ReadonlyArray<string>
): Effect.Effect<number, never, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({
    cwd: process.cwd(),
    command,
    args
  }).pipe(Effect.catchAll(() => Effect.succeed(1)))

export const resolveDockerCommand = (): Effect.Effect<
  ReadonlyArray<string>,
  never,
  CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*(_) {
    const dockerInfoExit = yield* _(runExitCode("docker", ["info"]))
    if (dockerInfoExit === 0) {
      return ["docker"]
    }

    const sudoDockerInfoExit = yield* _(runExitCode("sudo", ["-n", "docker", "info"]))
    return sudoDockerInfoExit === 0 ? ["sudo", "docker"] : ["docker"]
  })

const runCompose = (
  args: ReadonlyArray<string>
): Effect.Effect<void, ControllerBootstrapError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const dockerCommand = yield* _(resolveDockerCommand())
    const command = dockerCommand[0] ?? "docker"
    const commandArgs = [
      ...dockerCommand.slice(1),
      "compose",
      "-f",
      composeFilePath(),
      ...args
    ]
    const exitCode = yield* _(runExitCode(command, commandArgs))

    if (exitCode === 0) {
      return
    }

    return yield* _(
      Effect.fail(
        {
          _tag: "ControllerBootstrapError",
          message: [
            "Failed to start docker-git controller.",
            `Command: ${[command, ...commandArgs].join(" ")}`,
            `Exit code: ${exitCode}`
          ].join("\n")
        } satisfies ControllerBootstrapError
      )
    )
  })

const probeHealth = (apiBaseUrl: string): Effect.Effect<void, ControllerBootstrapError> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(client.get(`${apiBaseUrl}/health`, { headers: { accept: "application/json" } }))

    if (response.status >= 200 && response.status < 300) {
      return
    }

    return yield* _(
      Effect.fail(
        {
          _tag: "ControllerBootstrapError",
          message: `docker-git controller health returned ${response.status} at ${apiBaseUrl}/health`
        } satisfies ControllerBootstrapError
      )
    )
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((error): ControllerBootstrapError =>
      error._tag === "ControllerBootstrapError"
        ? error
        : {
          _tag: "ControllerBootstrapError",
          message: `docker-git controller health probe failed at ${apiBaseUrl}/health\nDetails: ${String(error)}`
        }
    )
  )

const waitForHealth = (apiBaseUrl: string) =>
  pipe(
    probeHealth(apiBaseUrl),
    Effect.retry(
      Schedule.addDelay(Schedule.recurs(30), () => Duration.seconds(2))
    ),
    Effect.mapError((error): ControllerBootstrapError => ({
      _tag: "ControllerBootstrapError",
      message: `docker-git controller did not become healthy at ${apiBaseUrl}/health\nDetails: ${error.message}`
    }))
  )

// CHANGE: bootstrap the API controller before issuing host-side API requests
// WHY: host CLI must not fall back to local state; controller owns .docker-git and project runtime
// QUOTE(ТЗ): "app(cli) инструмент общается только с API а API имеет свой .docker-git"
// REF: user-request-2026-04-01-api-only-host
// SOURCE: n/a
// FORMAT THEOREM: ∀cmd: controller(cmd) starts before api(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, ControllerBootstrapError, CommandExecutor>
// INVARIANT: controller is healthy before any host API dispatch
// COMPLEXITY: O(1) compose + O(k) health checks
export const ensureControllerReady = Effect.gen(function*(_) {
  const apiBaseUrl = resolveApiBaseUrl()
  const healthy = yield* _(
    probeHealth(apiBaseUrl).pipe(
      Effect.as(true),
      Effect.catchAll(() => Effect.succeed(false))
    )
  )

  if (healthy) {
    return
  }

  yield* _(runCompose(["up", "-d", "--build"]))
  return yield* _(waitForHealth(apiBaseUrl))
})
