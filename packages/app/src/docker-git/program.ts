import type { Command, ParseError } from "@effect-template/lib/core/domain"
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
import { downAllDockerGitProjects, listProjectStatus } from "@effect-template/lib/usecases/projects"
import {
  stateCommit,
  stateInit,
  statePath,
  statePull,
  statePush,
  stateStatus,
  stateSync
} from "@effect-template/lib/usecases/state-repo"
import {
  killTerminalProcess,
  listTerminalSessions,
  tailTerminalLogs
} from "@effect-template/lib/usecases/terminal-sessions"
import { Effect, Match, pipe } from "effect"
import { readCommand } from "./cli/read-command.js"
import { attachTmux, listTmuxPanes } from "./tmux.js"

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

type NonBaseCommand = Exclude<
  Command,
  | { readonly _tag: "Help" }
  | { readonly _tag: "Create" }
  | { readonly _tag: "Status" }
  | { readonly _tag: "DownAll" }
  | { readonly _tag: "Menu" }
>

const handleNonBaseCommand = (command: NonBaseCommand) =>
  Match.value(command).pipe(
    Match.when({ _tag: "StatePath" }, () => statePath),
    Match.when({ _tag: "StateInit" }, (cmd) => stateInit(cmd)),
    Match.when({ _tag: "StateStatus" }, () => stateStatus),
    Match.when({ _tag: "StatePull" }, () => statePull),
    Match.when({ _tag: "StateCommit" }, (cmd) => stateCommit(cmd.message)),
    Match.when({ _tag: "StatePush" }, () => statePush),
    Match.when({ _tag: "StateSync" }, (cmd) => stateSync(cmd.message)),
    Match.when({ _tag: "AuthGithubLogin" }, (cmd) => authGithubLogin(cmd)),
    Match.when({ _tag: "AuthGithubStatus" }, (cmd) => authGithubStatus(cmd)),
    Match.when({ _tag: "AuthGithubLogout" }, (cmd) => authGithubLogout(cmd)),
    Match.when({ _tag: "AuthCodexLogin" }, (cmd) => authCodexLogin(cmd)),
    Match.when({ _tag: "AuthCodexStatus" }, (cmd) => authCodexStatus(cmd)),
    Match.when({ _tag: "AuthCodexLogout" }, (cmd) => authCodexLogout(cmd)),
    Match.when({ _tag: "Attach" }, (cmd) => attachTmux(cmd)),
    Match.when({ _tag: "Panes" }, (cmd) => listTmuxPanes(cmd)),
    Match.when({ _tag: "SessionsList" }, (cmd) => listTerminalSessions(cmd)),
    Match.when({ _tag: "SessionsKill" }, (cmd) => killTerminalProcess(cmd)),
    Match.when({ _tag: "SessionsLogs" }, (cmd) => tailTerminalLogs(cmd)),
    Match.exhaustive
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
      Match.when({ _tag: "DownAll" }, () => downAllDockerGitProjects),
      Match.when({ _tag: "Menu" }, () => runMenu),
      Match.orElse((cmd) => handleNonBaseCommand(cmd))
    )
  ),
  Effect.catchTag("FileExistsError", (error) =>
    pipe(
      Effect.logWarning(renderError(error)),
      Effect.asVoid
    )),
  Effect.catchTag("DockerAccessError", logWarningAndExit),
  Effect.catchTag("DockerCommandError", logWarningAndExit),
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
