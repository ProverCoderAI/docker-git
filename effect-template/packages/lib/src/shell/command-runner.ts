import * as Command from "@effect/platform/Command"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

type RunCommandSpec = {
  readonly cwd: string
  readonly command: string
  readonly args: ReadonlyArray<string>
}

export const runCommandWithExitCodes = <E>(
  spec: RunCommandSpec,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<void, E | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const command = pipe(
      Command.make(spec.command, ...spec.args),
      Command.workingDirectory(spec.cwd),
      Command.stdout("inherit"),
      Command.stderr("inherit")
    )
    const exitCode = yield* _(Command.exitCode(command))
    const numericExitCode = Number(exitCode)
    if (!okExitCodes.includes(numericExitCode)) {
      return yield* _(Effect.fail(onFailure(numericExitCode)))
    }
  })
