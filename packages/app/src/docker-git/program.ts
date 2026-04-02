import type { Command } from "@lib/core/domain"
import { Effect, Match, pipe } from "effect"

import {
  type ApiProjectDetails,
  type ApiProjectSummary,
  applyAllProjects,
  codexImport,
  codexLogout,
  codexStatus,
  createProject,
  downAllProjects,
  githubLogin,
  githubLogout,
  githubStatus,
  listProjects,
  renderJsonPayload,
  renderProjectSummaryLine
} from "./api-client.js"
import { readCommand } from "./cli/read-command.js"
import { usageText } from "./cli/usage.js"
import { type ControllerRuntime, ensureControllerReady } from "./controller.js"
import type { CliError, UnsupportedCommandError } from "./host-errors.js"
import { renderCliError } from "./host-errors.js"
import { autoOpenProjectSsh } from "./host-ssh.js"
import { runMenu } from "./menu.js"
import { openExistingProjectSsh } from "./open-project.js"

type OperationalCommand = Exclude<Command, { readonly _tag: "Help" }>
type UnsupportedOperationalCommandTag =
  | "Attach"
  | "Panes"
  | "SessionsList"
  | "SessionsKill"
  | "SessionsLogs"
  | "ScrapExport"
  | "ScrapImport"
  | "McpPlaywrightUp"
  | "Apply"
  | "SessionGistBackup"
  | "SessionGistList"
  | "SessionGistView"
  | "SessionGistDownload"
  | "StatePath"
  | "StateInit"
  | "StateStatus"
  | "StatePull"
  | "StateCommit"
  | "StatePush"
  | "StateSync"
  | "AuthCodexLogin"
  | "AuthClaudeLogin"
  | "AuthClaudeStatus"
  | "AuthClaudeLogout"
  | "AuthGeminiLogin"
  | "AuthGeminiStatus"
  | "AuthGeminiLogout"

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

const withControllerReady = <E, R>(
  effect: Effect.Effect<void, E, R>
) =>
  pipe(
    ensureControllerReady(),
    Effect.zipRight(effect)
  )

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

const handleGithubLoginCommand = (command: Extract<OperationalCommand, { readonly _tag: "AuthGithubLogin" }>) =>
  withControllerReady(
    pipe(githubLogin(command), Effect.flatMap((payload) => Effect.log(renderJsonPayload(payload))))
  )

const handleGithubStatusCommand = (command: Extract<OperationalCommand, { readonly _tag: "AuthGithubStatus" }>) =>
  withControllerReady(
    pipe(githubStatus(command), Effect.flatMap((payload) => Effect.log(renderJsonPayload(payload))))
  )

const handleGithubLogoutCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthGithubLogout" }>
) =>
  withControllerReady(
    pipe(
      githubLogout(command),
      Effect.zipRight(Effect.log("GitHub auth removed from controller state."))
    )
  )

const handleCodexImportCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexImport" }>
) =>
  withControllerReady(
    pipe(codexImport(command), Effect.flatMap((payload) => Effect.log(renderJsonPayload(payload))))
  )

const handleCodexStatusCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexStatus" }>
) =>
  withControllerReady(
    pipe(codexStatus(command), Effect.flatMap((payload) => Effect.log(renderJsonPayload(payload))))
  )

const handleCodexLogoutCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexLogout" }>
) =>
  withControllerReady(
    pipe(
      codexLogout(command),
      Effect.zipRight(Effect.log("Codex auth removed from controller state."))
    )
  )

const unsupportedOperationalCommands: Record<
  UnsupportedOperationalCommandTag,
  { readonly command: string; readonly message: string }
> = {
  Attach: { command: "attach", message: "Host-side SSH attach is disabled in API-only mode." },
  Panes: { command: "panes", message: "Host-side pane inspection is disabled in API-only mode." },
  SessionsList: { command: "sessions", message: "Terminal session inspection is disabled in API-only mode." },
  SessionsKill: { command: "sessions kill", message: "Terminal session control is disabled in API-only mode." },
  SessionsLogs: { command: "sessions logs", message: "Terminal session log access is disabled in API-only mode." },
  ScrapExport: { command: "scrap export", message: "Scrap export is disabled in API-only host mode." },
  ScrapImport: { command: "scrap import", message: "Scrap import is disabled in API-only host mode." },
  McpPlaywrightUp: {
    command: "mcp-playwright",
    message: "Playwright sidecar management is disabled in API-only host mode."
  },
  Apply: {
    command: "Apply",
    message: "Command Apply is not available in API-only host mode."
  },
  SessionGistBackup: {
    command: "session-gists backup",
    message: "Session gist backup is disabled in API-only host mode."
  },
  SessionGistList: {
    command: "session-gists list",
    message: "Session gist list is disabled in API-only host mode."
  },
  SessionGistView: {
    command: "session-gists view",
    message: "Session gist view is disabled in API-only host mode."
  },
  SessionGistDownload: {
    command: "session-gists download",
    message: "Session gist download is disabled in API-only host mode."
  },
  StatePath: { command: "state path", message: "Host state commands are disabled in API-only mode." },
  StateInit: { command: "state init", message: "Host state commands are disabled in API-only mode." },
  StateStatus: { command: "state status", message: "Host state commands are disabled in API-only mode." },
  StatePull: { command: "state pull", message: "Host state commands are disabled in API-only mode." },
  StateCommit: { command: "state commit", message: "Host state commands are disabled in API-only mode." },
  StatePush: { command: "state push", message: "Host state commands are disabled in API-only mode." },
  StateSync: { command: "state sync", message: "Host state commands are disabled in API-only mode." },
  AuthCodexLogin: {
    command: "auth codex login",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthClaudeLogin: {
    command: "auth claude login",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthClaudeStatus: {
    command: "auth claude status",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthClaudeLogout: {
    command: "auth claude logout",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthGeminiLogin: {
    command: "auth gemini login",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthGeminiStatus: {
    command: "auth gemini status",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthGeminiLogout: {
    command: "auth gemini logout",
    message: "Only GitHub auth is routed through the controller in host API mode."
  }
}

const unsupportedOperationalCommand = (
  command: UnsupportedOperationalCommand
): Effect.Effect<void, UnsupportedCommandError> => {
  const spec = unsupportedOperationalCommands[command._tag]
  return unsupported(spec.command, spec.message)
}

const dispatchOperationalCommand = (
  command: OperationalCommand
): Effect.Effect<void, CliError, ControllerRuntime> =>
  Match.value(command).pipe(
    Match.when({ _tag: "Menu" }, () => withControllerReady(runMenu)),
    Match.when({ _tag: "Create" }, handleCreateCommand),
    Match.when({ _tag: "Open" }, handleOpenCommand),
    Match.when({ _tag: "Status" }, handleStatusCommand),
    Match.when({ _tag: "DownAll" }, handleDownAllCommand),
    Match.when({ _tag: "ApplyAll" }, handleApplyAllCommand),
    Match.when({ _tag: "AuthGithubLogin" }, handleGithubLoginCommand),
    Match.when({ _tag: "AuthGithubStatus" }, handleGithubStatusCommand),
    Match.when({ _tag: "AuthGithubLogout" }, handleGithubLogoutCommand),
    Match.when({ _tag: "AuthCodexImport" }, handleCodexImportCommand),
    Match.when({ _tag: "AuthCodexStatus" }, handleCodexStatusCommand),
    Match.when({ _tag: "AuthCodexLogout" }, handleCodexLogoutCommand),
    Match.orElse((unsupported) => unsupportedOperationalCommand(unsupported))
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
