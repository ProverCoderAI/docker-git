import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, Either } from "effect"

import type { ProjectConfig } from "../core/domain.js"
import { runCommandCapture, runCommandWithExitCodes } from "../shell/command-runner.js"
import type { CommandFailedError, ScrapWipeRefusedError } from "../shell/errors.js"
import {
  CommandFailedError as CommandFailedErrorClass,
  ScrapWipeRefusedError as ScrapWipeRefusedErrorClass
} from "../shell/errors.js"

const dockerOk = [0]

export type ScrapTemplate = {
  readonly sshUser: string
  readonly containerName: string
  readonly targetDir: string
  readonly volumeName: string
  readonly codexHome: string
}

export const buildScrapTemplate = (config: ProjectConfig): ScrapTemplate => ({
  sshUser: config.template.sshUser,
  containerName: config.template.containerName,
  targetDir: config.template.targetDir,
  volumeName: config.template.volumeName,
  codexHome: config.template.codexHome
})

export const eitherToEffect = <A, E>(either: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.match(either, {
    onLeft: (error) => Effect.fail(error),
    onRight: (value) => Effect.succeed(value)
  })

export const shellEscape = (value: string): string => {
  if (value.length === 0) {
    return "''"
  }
  if (!/[^\w@%+=:,./-]/.test(value)) {
    return value
  }
  const escaped = value.replaceAll("'", "'\"'\"'")
  return `'${escaped}'`
}

export const runShell = (
  cwd: string,
  label: string,
  script: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    { cwd, command: "sh", args: ["-lc", script] },
    dockerOk,
    (exitCode) => new CommandFailedErrorClass({ command: `sh (${label})`, exitCode })
  )

export const runDockerExecCapture = (
  cwd: string,
  label: string,
  containerName: string,
  script: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    { cwd, command: "docker", args: ["exec", containerName, "sh", "-lc", script] },
    dockerOk,
    (exitCode) => new CommandFailedErrorClass({ command: `docker exec (${label})`, exitCode })
  )

export const runDockerExec = (
  cwd: string,
  label: string,
  containerName: string,
  script: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    { cwd, command: "docker", args: ["exec", containerName, "sh", "-lc", script] },
    dockerOk,
    (exitCode) => new CommandFailedErrorClass({ command: `docker exec (${label})`, exitCode })
  )

export const ensureSafeScrapImportWipe = (
  wipe: boolean,
  template: ScrapTemplate,
  relative: string
): Effect.Effect<void, ScrapWipeRefusedError> =>
  wipe && relative.length === 0
    ? Effect.fail(
      new ScrapWipeRefusedErrorClass({
        sshUser: template.sshUser,
        targetDir: template.targetDir,
        reason: `wipe would target /home/${template.sshUser}`
      })
    )
    : Effect.void
