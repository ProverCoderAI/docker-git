import { Effect, Match, pipe } from "effect"

import type { Command, ParseError } from "@effect-template/lib/core/domain"
import { readCommand } from "@effect-template/lib/shell/cli"
import { createProject } from "@effect-template/lib/usecases/actions"
import {
  authCodexLogin,
  authCodexLogout,
  authCodexStatus,
  authGithubLogin,
  authGithubLogout,
  authGithubStatus
} from "@effect-template/lib/usecases/auth"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { renderError } from "@effect-template/lib/usecases/errors"
import { listProjectStatus } from "@effect-template/lib/usecases/projects"

import { runMenu } from "./menu.js"

const isParseError = (error: AppError): error is ParseError =>
  error._tag === "UnknownCommand" ||
  error._tag === "UnknownOption" ||
  error._tag === "MissingOptionValue" ||
  error._tag === "MissingRequiredOption" ||
  error._tag === "InvalidOption" ||
  error._tag === "UnexpectedArgument"

const setExitCode = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code
  })

const logWarningAndExit = (error: AppError) =>
  pipe(
    Effect.logWarning(renderError(error)),
    Effect.tap(() => setExitCode(1)),
    Effect.asVoid
  )

const logErrorAndExit = (error: AppError) =>
  pipe(
    Effect.logError(renderError(error)),
    Effect.tap(() => setExitCode(1)),
    Effect.asVoid
  )

// CHANGE: compose CLI program with typed errors and shell effects
// WHY: keep a thin entry layer over pure parsing and template generation
// QUOTE(ТЗ): "CLI команду... создавать докер образы"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: handle(cmd) terminates with typed outcome
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: help is printed without side effects beyond logs
// COMPLEXITY: O(n) where n = |files|
export const program = pipe(
  readCommand,
  Effect.flatMap((command: Command) =>
    Match.value(command).pipe(
      Match.when({ _tag: "Help" }, ({ message }) => Effect.log(message)),
      Match.when({ _tag: "Create" }, (create) => createProject(create)),
      Match.when({ _tag: "Status" }, () => listProjectStatus),
      Match.when({ _tag: "AuthGithubLogin" }, (command) => authGithubLogin(command)),
      Match.when({ _tag: "AuthGithubStatus" }, (command) => authGithubStatus(command)),
      Match.when({ _tag: "AuthGithubLogout" }, (command) => authGithubLogout(command)),
      Match.when({ _tag: "AuthCodexLogin" }, (command) => authCodexLogin(command)),
      Match.when({ _tag: "AuthCodexStatus" }, (command) => authCodexStatus(command)),
      Match.when({ _tag: "AuthCodexLogout" }, (command) => authCodexLogout(command)),
      Match.when({ _tag: "Menu" }, () => runMenu),
      Match.exhaustive
    )
  ),
  Effect.catchTag("FileExistsError", (error) =>
    pipe(
      Effect.logWarning(renderError(error)),
      Effect.asVoid
    )),
  Effect.catchTag("AuthError", logWarningAndExit),
  Effect.catchTag("CommandFailedError", logWarningAndExit),
  Effect.matchEffect({
    onFailure: (error) =>
      isParseError(error)
        ? logErrorAndExit(error)
        : pipe(
          Effect.logError(renderError(error)),
          Effect.flatMap(() => Effect.fail(error))
        ),
    onSuccess: () => Effect.void
  }),
  Effect.asVoid
)
