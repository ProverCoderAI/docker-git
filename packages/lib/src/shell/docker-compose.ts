import { ExitCode } from "@effect/platform/CommandExecutor"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Duration, Effect, pipe, Schedule } from "effect"

import { isNvidiaRuntimeFailure } from "../core/gpu.js"
import { runCommandCapture, runCommandWithStreamingOutput } from "./command-runner.js"
import { composeSpec, resolveDockerComposeEnv } from "./docker-compose-env.js"
import { DockerCommandError } from "./errors.js"

const buildComposeCommand = (
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>>
) => ({
  ...composeSpec(cwd, args),
  ...(Object.keys(env).length > 0 ? { env } : {})
})

const runCompose = (
  cwd: string,
  args: ReadonlyArray<string>,
  okExitCodes: ReadonlyArray<number>
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const env = yield* _(resolveDockerComposeEnv(cwd))
    yield* _(
      runCommandWithStreamingOutput(
        buildComposeCommand(cwd, args, env),
        okExitCodes,
        (exitCode, output) => new DockerCommandError({ exitCode, ...(output.length > 0 ? { details: output } : {}) })
      )
    )
  })

const runComposeCapture = (
  cwd: string,
  args: ReadonlyArray<string>,
  okExitCodes: ReadonlyArray<number>
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const env = yield* _(resolveDockerComposeEnv(cwd))
    return yield* _(
      runCommandCapture(
        buildComposeCommand(cwd, args, env),
        okExitCodes,
        (exitCode) => new DockerCommandError({ exitCode })
      )
    )
  })

const dockerComposeUpRetrySchedule = Schedule.addDelay(
  Schedule.recurs(2),
  () => Duration.seconds(2)
)

// CHANGE: classify compose-up failures that are worth retrying.
// WHY: host NVIDIA runtime misconfiguration is deterministic, so repeated compose attempts only delay fallback.
// QUOTE(ТЗ): "nvidia-container-cli: initialization error: load library failed: libnvidia-ml.so.1"
// REF: issue-291
// SOURCE: n/a
// FORMAT THEOREM: forall e: nvidia_runtime_failure(e) -> retryable(e)=false
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: non-Docker platform errors keep the existing retry behavior
// COMPLEXITY: O(n * m) where n = |details| and m = marker count
const isRetryableDockerComposeUpError = (error: DockerCommandError | PlatformError): boolean => {
  if (error._tag !== "DockerCommandError") {
    return true
  }

  return !isNvidiaRuntimeFailure(error.details)
}

const retryDockerComposeUp = (
  cwd: string,
  effect: Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor>
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  effect.pipe(
    Effect.tapError((error) =>
      isRetryableDockerComposeUpError(error)
        ? Effect.logWarning(
          `docker compose up failed in ${cwd}; retrying (possible transient Docker Hub/DNS issue)...`
        )
        : Effect.void
    ),
    Effect.retry({
      schedule: dockerComposeUpRetrySchedule,
      while: isRetryableDockerComposeUpError
    })
  )

export type DockerComposeUpBuildMode = "build" | "reuse"

const dockerComposeUpArgs = (
  buildMode: DockerComposeUpBuildMode
): ReadonlyArray<string> => buildMode === "reuse" ? ["up", "-d"] : ["up", "-d", "--build"]

export const runDockerComposeUp = (
  cwd: string,
  options: {
    readonly buildMode?: DockerComposeUpBuildMode
  } = {}
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  retryDockerComposeUp(
    cwd,
    runCompose(cwd, dockerComposeUpArgs(options.buildMode ?? "build"), [Number(ExitCode(0))])
  )

export const dockerComposeUpRecreateArgs: ReadonlyArray<string> = [
  "up",
  "-d",
  "--build",
  "--force-recreate"
]

export const runDockerComposeUpRecreate = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  retryDockerComposeUp(cwd, runCompose(cwd, dockerComposeUpRecreateArgs, [Number(ExitCode(0))]))

export const runDockerComposeDown = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["down"], [Number(ExitCode(0))])

export const runDockerComposeStop = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["stop"], [Number(ExitCode(0))])

export const runDockerComposeDownVolumes = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["down", "-v", "--remove-orphans"], [Number(ExitCode(0))])

export const runDockerComposeRecreate = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(runDockerComposeDown(cwd), Effect.zipRight(runDockerComposeUp(cwd)))

export const runDockerComposePs = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["ps"], [Number(ExitCode(0))])

export const runDockerComposePsFormatted = (
  cwd: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runComposeCapture(
    cwd,
    ["ps", "--format", "{{.Name}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"],
    [Number(ExitCode(0))]
  )

export const runDockerComposeLogs = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["logs", "--tail", "200"], [Number(ExitCode(0)), 130])

export const runDockerComposeLogsFollow = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["logs", "--follow", "--tail", "0"], [Number(ExitCode(0)), 130])
