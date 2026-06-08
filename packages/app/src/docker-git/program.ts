import { Effect, Match, pipe } from "effect"
import type { Command } from "./frontend-lib/core/domain.js"

import {
  type ApiProjectDetails,
  type ApiProjectSummary,
  applyAllProjects,
  commitState,
  createProject,
  downAllProjects,
  initState,
  listProjects,
  pullState,
  pushState,
  readContainerTaskLogs,
  readContainerTaskSnapshot,
  readStatePath,
  readStateStatus,
  renderContainerTaskSnapshot,
  renderProjectSummaryLine,
  stopContainerTask,
  syncState
} from "./api-client.js"
import { runBrowserFrontendCommandWithOptions } from "./browser-frontend.js"
import { readCommand } from "./cli/read-command.js"
import { usageText } from "./cli/usage.js"
import { type ControllerRuntime, ensureControllerReady } from "./controller.js"
import type { CliError, UnsupportedCommandError } from "./host-errors.js"
import { renderCliError } from "./host-errors.js"
import { autoOpenProjectSsh } from "./host-ssh.js"
import { runMenu } from "./menu.js"
import { openExistingProjectSsh } from "./open-project.js"
import { dispatchRoutedAuthCommand, isRoutedAuthCommand } from "./program-auth.js"
import { unsupportedOperationalCommands, type UnsupportedOperationalCommandTag } from "./program-unsupported.js"

type OperationalCommand = Exclude<Command, { readonly _tag: "Help" }>

type UnsupportedOperationalCommand = Extract<
  OperationalCommand,
  { readonly _tag: UnsupportedOperationalCommandTag }
>

const setExitCode = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code
  })

const logAndExit = (error: CliError, level: "warning" | "error" = "error") =>
  pipe(
    level === "warning" ? Effect.logWarning(renderCliError(error)) : Effect.logError(renderCliError(error)),
    Effect.tap(() => setExitCode(1)),
    Effect.asVoid
  )

const unsupported = (command: string, message: string): Effect.Effect<void, UnsupportedCommandError> =>
  Effect.fail({
    _tag: "UnsupportedCommandError",
    command,
    message
  })

const withControllerReady = <E, R>(effect: Effect.Effect<void, E, R>) =>
  pipe(ensureControllerReady(), Effect.zipRight(effect))

const renderProjectList = (projects: ReadonlyArray<ApiProjectSummary>) =>
  Effect.gen(function*(_) {
    if (projects.length === 0) {
      yield* _(Effect.log("No docker-git projects found."))
      return
    }

    yield* _(Effect.log(`Found ${projects.length} docker-git project(s):`))
    for (const project of projects) {
      yield* _(Effect.log(renderProjectSummaryLine(project)))
    }
  })

const renderCreateResult = (project: ApiProjectDetails | null) =>
  Effect.gen(function*(_) {
    if (project === null) {
      yield* _(Effect.log("Project created."))
      return
    }

    yield* _(Effect.log(`Project created: ${project.displayName}`))
    yield* _(Effect.log(`Project ID: ${project.id}`))
    yield* _(Effect.log(`Status: ${project.statusLabel}`))
  })

const handleCreateCommand = (command: Extract<OperationalCommand, { readonly _tag: "Create" }>) =>
  withControllerReady(
    pipe(
      createProject(command),
      Effect.flatMap((project) =>
        pipe(
          renderCreateResult(project),
          Effect.zipRight(autoOpenProjectSsh(command, project))
        )
      )
    )
  )

const handleOpenCommand = (command: Extract<OperationalCommand, { readonly _tag: "Open" }>) =>
  withControllerReady(openExistingProjectSsh(command))

const handleStatusCommand = () =>
  withControllerReady(pipe(listProjects(), Effect.flatMap((projects) => renderProjectList(projects))))

const handleDownAllCommand = () =>
  withControllerReady(pipe(downAllProjects(), Effect.zipRight(Effect.log("All docker-git projects were stopped."))))

const handleApplyAllCommand = (command: Extract<OperationalCommand, { readonly _tag: "ApplyAll" }>) =>
  withControllerReady(
    pipe(
      applyAllProjects(command.activeOnly),
      Effect.zipRight(
        Effect.log(
          command.activeOnly
            ? "Applied docker-git config to running projects."
            : "Applied docker-git config to all projects."
        )
      )
    )
  )

const logOutput = (output: string) => Effect.log(output)

const handleStatePathCommand = () =>
  withControllerReady(pipe(readStatePath(), Effect.flatMap((output) => logOutput(output))))

const handleStateInitCommand = (command: Extract<OperationalCommand, { readonly _tag: "StateInit" }>) =>
  withControllerReady(pipe(initState(command), Effect.flatMap((output) => logOutput(output))))

const handleStateStatusCommand = () =>
  withControllerReady(pipe(readStateStatus(), Effect.flatMap((output) => logOutput(output))))

const handleStatePullCommand = () =>
  withControllerReady(pipe(pullState(), Effect.flatMap((output) => logOutput(output))))

const handleStateCommitCommand = (command: Extract<OperationalCommand, { readonly _tag: "StateCommit" }>) =>
  withControllerReady(pipe(commitState(command), Effect.flatMap((output) => logOutput(output))))

const handleStatePushCommand = () =>
  withControllerReady(pipe(pushState(), Effect.flatMap((output) => logOutput(output))))

const handleStateSyncCommand = (command: Extract<OperationalCommand, { readonly _tag: "StateSync" }>) =>
  withControllerReady(pipe(syncState(command), Effect.flatMap((output) => logOutput(output))))

const handleSessionsListCommand = (command: Extract<OperationalCommand, { readonly _tag: "SessionsList" }>) =>
  withControllerReady(
    pipe(
      readContainerTaskSnapshot(command.projectDir, command.includeDefault),
      Effect.flatMap((snapshot) =>
        snapshot === null
          ? Effect.log("Invalid container task snapshot returned by API.")
          : Effect.log(renderContainerTaskSnapshot(snapshot))
      )
    )
  )

const handleSessionsKillCommand = (command: Extract<OperationalCommand, { readonly _tag: "SessionsKill" }>) =>
  withControllerReady(
    pipe(
      stopContainerTask(command.projectDir, command.pid),
      Effect.zipRight(Effect.log(`Sent SIGTERM to PID ${command.pid}`))
    )
  )

const handleSessionsLogsCommand = (command: Extract<OperationalCommand, { readonly _tag: "SessionsLogs" }>) =>
  withControllerReady(
    pipe(
      readContainerTaskLogs(command.projectDir, command.pid, command.lines),
      Effect.flatMap((output) => logOutput(output))
    )
  )

const unsupportedOperationalCommand = (
  command: UnsupportedOperationalCommand
): Effect.Effect<void, UnsupportedCommandError> => {
  const spec = unsupportedOperationalCommands[command._tag]
  return unsupported(spec.command, spec.message)
}

type DirectOperationalCommand = Extract<
  OperationalCommand,
  { readonly _tag: "Menu" | "Browser" | "Create" | "Open" | "Status" | "DownAll" | "ApplyAll" }
>
type RoutedOperationalCommand = Exclude<OperationalCommand, DirectOperationalCommand>
const dispatchRoutedOperationalCommand = (
  command: RoutedOperationalCommand
): Effect.Effect<void, CliError, ControllerRuntime> =>
  Match.value(command).pipe(
    Match.when(isRoutedAuthCommand, dispatchRoutedAuthCommand),
    Match.when({ _tag: "StatePath" }, handleStatePathCommand),
    Match.when({ _tag: "StateInit" }, handleStateInitCommand),
    Match.when({ _tag: "StateStatus" }, handleStateStatusCommand),
    Match.when({ _tag: "StatePull" }, handleStatePullCommand),
    Match.when({ _tag: "StateCommit" }, handleStateCommitCommand),
    Match.when({ _tag: "StatePush" }, handleStatePushCommand),
    Match.when({ _tag: "StateSync" }, handleStateSyncCommand),
    Match.when({ _tag: "SessionsList" }, handleSessionsListCommand),
    Match.when({ _tag: "SessionsKill" }, handleSessionsKillCommand),
    Match.when({ _tag: "SessionsLogs" }, handleSessionsLogsCommand),
    Match.orElse((unsupported) => unsupportedOperationalCommand(unsupported))
  )

const dispatchOperationalCommand = (
  command: OperationalCommand
): Effect.Effect<void, CliError, ControllerRuntime> =>
  Match.value(command).pipe(
    Match.when({ _tag: "Menu" }, () => withControllerReady(runMenu)),
    Match.when({ _tag: "Browser" }, (command) => runBrowserFrontendCommandWithOptions({ daemon: command.daemon })),
    Match.when({ _tag: "Create" }, handleCreateCommand),
    Match.when({ _tag: "Open" }, handleOpenCommand),
    Match.when({ _tag: "Status" }, handleStatusCommand),
    Match.when({ _tag: "DownAll" }, handleDownAllCommand),
    Match.when({ _tag: "ApplyAll" }, handleApplyAllCommand),
    Match.orElse((next) => dispatchRoutedOperationalCommand(next))
  )

const runCommand: Effect.Effect<void, CliError, ControllerRuntime> = pipe(
  readCommand,
  Effect.flatMap((command: Command) =>
    command._tag === "Help"
      ? Effect.log(usageText)
      : dispatchOperationalCommand(command)
  )
)

// CHANGE: route host CLI commands through the API controller only
// WHY: host must not read local .docker-git state or execute project lifecycle directly
// QUOTE(ТЗ): "app(cli) инструмент общается только с API"
// REF: user-request-2026-04-01-api-only-host
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: operational(cmd) -> api(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, CliError, never>
// INVARIANT: help remains local; unsupported commands fail explicitly
// COMPLEXITY: O(1) per command plus API round-trips
export const program = pipe(
  runCommand,
  Effect.matchEffect({
    onFailure: (error: CliError) => logAndExit(error),
    onSuccess: () => Effect.void
  })
)
