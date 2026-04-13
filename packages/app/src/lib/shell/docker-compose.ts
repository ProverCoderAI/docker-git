import { ExitCode } from "@effect/platform/CommandExecutor"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Duration, Effect, pipe, Schedule } from "effect"

import { runCommandCapture, runCommandWithCapturedOutput } from "./command-runner.js"
import { composeSpec, resolveDockerComposeEnv } from "./docker-compose-env.js"
import { DockerCommandError } from "./errors.js"

const buildComposeCommand = (
  cwd: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>
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
      runCommandWithCapturedOutput(
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

const retryDockerComposeUp = (
  cwd: string,
  effect: Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor>
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  effect.pipe(
    Effect.tapError(() =>
      Effect.logWarning(
        `docker compose up failed in ${cwd}; retrying (possible transient Docker Hub/DNS issue)...`
      )
    ),
    Effect.retry(dockerComposeUpRetrySchedule)
  )

export const runDockerComposeUp = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  retryDockerComposeUp(cwd, runCompose(cwd, ["up", "-d", "--build"], [Number(ExitCode(0))]))

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
