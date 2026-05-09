import { Effect, Match, pipe } from "effect"

import {
  codexImport,
  codexLogin,
  codexLogout,
  codexStatus,
  githubLogin,
  githubLogout,
  githubStatus,
  gitlabLogin,
  gitlabLogout,
  gitlabStatus,
  type JsonValue,
  renderJsonPayload
} from "./api-client.js"
import { type ControllerRuntime, ensureControllerReady } from "./controller.js"
import type { Command } from "./frontend-lib/core/domain.js"
import type { CliError } from "./host-errors.js"

type OperationalCommand = Exclude<Command, { readonly _tag: "Help" }>

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
      | "AuthCodexLogin"
      | "AuthCodexImport"
      | "AuthCodexStatus"
      | "AuthCodexLogout"
  }
>

const withControllerReady = <E, R>(effect: Effect.Effect<void, E, R>) =>
  pipe(ensureControllerReady(), Effect.zipRight(effect))

const renderAuthPayload = (payload: JsonValue) => Effect.log(renderJsonPayload(payload))

const routedAuthTags: Readonly<Record<string, true>> = {
  AuthCodexImport: true,
  AuthCodexLogin: true,
  AuthCodexLogout: true,
  AuthCodexStatus: true,
  AuthGithubLogin: true,
  AuthGithubLogout: true,
  AuthGithubStatus: true,
  AuthGitlabLogin: true,
  AuthGitlabLogout: true,
  AuthGitlabStatus: true
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

const handleCodexImportCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexImport" }>
) => withControllerReady(pipe(codexImport(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleCodexStatusCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexStatus" }>
) => withControllerReady(pipe(codexStatus(command), Effect.flatMap((payload) => renderAuthPayload(payload))))

const handleCodexLogoutCommand = (
  command: Extract<OperationalCommand, { readonly _tag: "AuthCodexLogout" }>
) =>
  withControllerReady(
    pipe(codexLogout(command), Effect.zipRight(Effect.log("Codex auth removed from controller state.")))
  )

export const dispatchRoutedAuthCommand = (
  command: RoutedAuthCommand
): Effect.Effect<void, CliError, ControllerRuntime> =>
  Match.value(command).pipe(
    Match.when({ _tag: "AuthGithubLogin" }, handleGithubLoginCommand),
    Match.when({ _tag: "AuthGithubStatus" }, handleGithubStatusCommand),
    Match.when({ _tag: "AuthGithubLogout" }, handleGithubLogoutCommand),
    Match.when({ _tag: "AuthGitlabLogin" }, handleGitlabLoginCommand),
    Match.when({ _tag: "AuthGitlabStatus" }, handleGitlabStatusCommand),
    Match.when({ _tag: "AuthGitlabLogout" }, handleGitlabLogoutCommand),
    Match.when({ _tag: "AuthCodexLogin" }, handleCodexLoginCommand),
    Match.when({ _tag: "AuthCodexImport" }, handleCodexImportCommand),
    Match.when({ _tag: "AuthCodexStatus" }, handleCodexStatusCommand),
    Match.when({ _tag: "AuthCodexLogout" }, handleCodexLogoutCommand),
    Match.exhaustive
  )
