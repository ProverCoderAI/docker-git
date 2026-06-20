import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

import { runCommandExitCode } from "./frontend-lib/shell/command-runner.js"
import type { ControllerBootstrapError } from "./host-errors.js"

const browserFrontendError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

const isTruthyEnv = (value: string | undefined): boolean =>
  value !== undefined && ["1", "on", "true", "yes"].includes(value.trim().toLowerCase())

export const shouldUsePrebuiltBrowserFrontend = (): boolean =>
  isTruthyEnv(process.env["DOCKER_GIT_E2E_USE_PREBUILT_WEB"])

export const ensurePrebuiltBrowserFrontend = (): Effect.Effect<
  void,
  ControllerBootstrapError | PlatformError,
  CommandExecutor.CommandExecutor
> =>
  pipe(
    runCommandExitCode({
      args: ["-c", "test -f packages/app/dist-web/index.html"],
      command: "sh",
      cwd: process.cwd()
    }),
    Effect.flatMap((exitCode) =>
      exitCode === 0
        ? Effect.void
        : Effect.fail(
          browserFrontendError(
            "Prebuilt browser frontend artifact is missing packages/app/dist-web/index.html."
          )
        )
    )
  )
