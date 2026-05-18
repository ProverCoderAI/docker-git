import { Effect, Match, pipe } from "effect"

import {
  type ApiTerminalSession,
  codexImport,
  codexLogin,
  codexLogout,
  codexStatus,
  createAuthTerminalSession,
  githubLogin,
  githubLogout,
  githubStatus,
  gitlabLogin,
  gitlabLogout,
  gitlabStatus,
  grokLogout,
  grokStatus,
  type JsonValue,
  renderJsonPayload
} from "./api-client.js"
import { type ControllerRuntime, ensureControllerReady } from "./controller.js"
import type { Command } from "./frontend-lib/core/domain.js"
import type { ApiRequestError, CliError } from "./host-errors.js"
import { terminalAuthTitle } from "./menu-auth-shared.js"
import { attachTerminalSession } from "./terminal-session-client.js"

type OperationalCommand = Exclude<Command, { readonly _tag: "Help" }>
type RoutedAuthEffect = Effect.Effect<void, CliError, ControllerRuntime>

export type RoutedAuthCommand = Extract<
  OperationalCommand,
  {
    readonly _tag:
      | "AuthGithubLogin"
      | "AuthGithubStatus"
      | "AuthGithubLogout"
      | "AuthGitlabLogin"
      | "AuthGitlabStatus"
      | "AuthGitlabLogout"
      | "AuthGrokLogin"
      | "AuthGrokStatus"
      | "AuthGrokLogout"
      | "AuthCodexLogin"
      | "AuthCodexImport"
      | "AuthCodexStatus"
      | "AuthCodexLogout"
  }
>

const withControllerReady = <E extends CliError, R>(
  effect: Effect.Effect<void, E, R>
): Effect.Effect<void, CliError, ControllerRuntime | R> => pipe(ensureControllerReady(), Effect.zipRight(effect))

const renderAuthPayload = (payload: JsonValue) => Effect.log(renderJsonPayload(payload))

const missingAuthTerminalSessionError = (provider: "GrokOauth"): ApiRequestError => ({
  _tag: "ApiRequestError",
  method: "POST",
  path: "/auth/terminal-sessions",
  message: `Controller did not create a terminal session for ${provider}.`
})

const routedAuthTags: Readonly<Record<string, true>> = {
  AuthCodexImport: true,
  AuthCodexLogin: true,
  AuthCodexLogout: true,
  AuthCodexStatus: true,
  AuthGithubLogin: true,
  AuthGithubLogout: true,
  AuthGithubStatus: true,
  AuthGrokLogin: true,
  AuthGrokLogout: true,
  AuthGitlabLogin: true,
  AuthGitlabLogout: true,
  AuthGitlabStatus: true,
  AuthGrokStatus: true
}

export const isRoutedAuthCommand = (command: OperationalCommand): command is RoutedAuthCommand =>
  Object.hasOwn(routedAuthTags, command._tag)

const handleGithubLoginCommand = (command: Extract<OperationalCommand, { readonly _tag: "AuthGithubLogin" }>) =>
  withControllerReady(pipe(githubLogin(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleGithubStatusCommand = (command: Extract<OperationalCommand, { readonly _tag: "AuthGithubStatus" }>) =>
  withControllerReady(pipe(githubStatus(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleGithubLogoutCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthGithubLogout" }>
) =>
  withControllerReady(
    pipe(githubLogout(command), Effect.zipRight(Effect.log("GitHub auth removed from controller state.")))
  )

const handleGitlabLoginCommand = (command: Extract<OperationalCommand, { readonly _tag: "AuthGitlabLogin" }>) =>
  withControllerReady(pipe(gitlabLogin(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleGitlabStatusCommand = (command: Extract<OperationalCommand, { readonly _tag: "AuthGitlabStatus" }>) =>
  withControllerReady(pipe(gitlabStatus(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleGitlabLogoutCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthGitlabLogout" }>
) =>
  withControllerReady(
    pipe(gitlabLogout(command), Effect.zipRight(Effect.log("GitLab auth removed from controller state.")))
  )

const handleCodexLoginCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexLogin" }>
) => withControllerReady(codexLogin(command))

const attachGrokAuthTerminalSession = (
  session: ApiTerminalSession | null
): Effect.Effect<void, CliError> =>
  session === null
    ? Effect.fail(missingAuthTerminalSessionError("GrokOauth"))
    : attachTerminalSession({
      header: terminalAuthTitle("GrokOauth"),
      session,
      websocketPath: `/auth/terminal-sessions/${encodeURIComponent(session.id)}/ws`
    })

const handleGrokLoginCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthGrokLogin" }>
) =>
  withControllerReady(
    createAuthTerminalSession("GrokOauth", command.label).pipe(
      Effect.flatMap((session) => attachGrokAuthTerminalSession(session))
    )
  )

const handleCodexImportCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexImport" }>
) => withControllerReady(pipe(codexImport(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleCodexStatusCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexStatus" }>
) => withControllerReady(pipe(codexStatus(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleGrokStatusCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthGrokStatus" }>
) => withControllerReady(pipe(grokStatus(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleGrokLogoutCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthGrokLogout" }>
) =>
  withControllerReady(
    pipe(grokLogout(command), Effect.zipRight(Effect.log("Grok auth removed from controller state.")))
  )

const handleCodexLogoutCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexLogout" }>
) =>
  withControllerReady(
    pipe(codexLogout(command), Effect.zipRight(Effect.log("Codex auth removed from controller state.")))
  )

export const dispatchRoutedAuthCommand = (
  command: RoutedAuthCommand
): RoutedAuthEffect =>
  Match.value(command).pipe(
    Match.when({ _tag: "AuthGithubLogin" }, handleGithubLoginCommand),
    Match.when({ _tag: "AuthGithubStatus" }, handleGithubStatusCommand),
    Match.when({ _tag: "AuthGithubLogout" }, handleGithubLogoutCommand),
    Match.when({ _tag: "AuthGitlabLogin" }, handleGitlabLoginCommand),
    Match.when({ _tag: "AuthGitlabStatus" }, handleGitlabStatusCommand),
    Match.when({ _tag: "AuthGitlabLogout" }, handleGitlabLogoutCommand),
    Match.when({ _tag: "AuthGrokLogin" }, handleGrokLoginCommand),
    Match.when({ _tag: "AuthGrokStatus" }, handleGrokStatusCommand),
    Match.when({ _tag: "AuthGrokLogout" }, handleGrokLogoutCommand),
    Match.when({ _tag: "AuthCodexLogin" }, handleCodexLoginCommand),
    Match.when({ _tag: "AuthCodexImport" }, handleCodexImportCommand),
    Match.when({ _tag: "AuthCodexStatus" }, handleCodexStatusCommand),
    Match.when({ _tag: "AuthCodexLogout" }, handleCodexLogoutCommand),
    Match.exhaustive
  )
