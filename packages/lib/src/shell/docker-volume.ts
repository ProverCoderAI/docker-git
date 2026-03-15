import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { Effect } from "effect"

import { runCommandWithExitCodes } from "./command-runner.js"
import { DockerCommandError } from "./errors.js"

const shellEscape = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

export const runDockerVolumeCreate = (
  cwd: string,
  volumeName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes({ cwd, command: "docker", args: ["volume", "create", volumeName] }, [Number(ExitCode(0))], (
    exitCode
  ) => new DockerCommandError({ exitCode }))

// CHANGE: replace a Docker volume with staged bootstrap files from the local filesystem
// WHY: controller/API mode must sync auth/env into Docker-managed storage without host bind mounts
// QUOTE(ТЗ): "Поднимается сервер и ты через него можешь общаться с контейнером"
// REF: user-request-2026-03-15-api-controller
// SOURCE: n/a
// FORMAT THEOREM: ∀v,d: seed(v,d) → contents(v)=snapshot(d)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: previous bootstrap contents are removed before the new snapshot is extracted
// COMPLEXITY: O(size(sourceDir))
export const runDockerVolumeReplaceFromDirectory = (
  cwd: string,
  volumeName: string,
  sourceDir: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> => {
  const command =
    `tar -C ${shellEscape(sourceDir)} -cf - . | ` +
    `docker run --rm -i -v ${shellEscape(`${volumeName}:/target`)} alpine:3.20 ` +
    `sh -euc ${shellEscape("mkdir -p /target && find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xf - -C /target")}`

  return runCommandWithExitCodes(
    { cwd, command: "bash", args: ["-lc", command] },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )
}
