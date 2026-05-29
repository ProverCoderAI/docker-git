import type { PlatformError } from "@effect/platform/Error"
import { Match } from "effect"

import { formatParseError } from "./cli/usage.js"
import type { ParseError } from "./frontend-lib/core/domain.js"
import type { CommandFailedError, InputReadError } from "./frontend-lib/shell/errors.js"
import type { TerminalSessionClientError } from "./terminal-session-client.js"

export type ControllerBootstrapError = {
  readonly _tag: "ControllerBootstrapError"
  readonly message: string
}

export const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

export type ApiRequestError = {
  readonly _tag: "ApiRequestError"
  readonly method: string
  readonly path: string
  readonly message: string
  readonly displayOnlyMessage?: boolean | undefined
}

export type ApiAuthRequiredError = {
  readonly _tag: "ApiAuthRequiredError"
  readonly provider: string
  readonly message: string
  readonly command: string
}

export type UnsupportedCommandError = {
  readonly _tag: "UnsupportedCommandError"
  readonly command: string
  readonly message: string
}

export type ProjectResolutionError = {
  readonly _tag: "ProjectResolutionError"
  readonly message: string
}

export type HostError =
  | ControllerBootstrapError
  | ApiRequestError
  | ApiAuthRequiredError
  | ProjectResolutionError
  | PlatformError
  | CommandFailedError
  | InputReadError
  | TerminalSessionClientError
  | UnsupportedCommandError

export type CliError = ParseError | HostError

const isParseError = (error: CliError): error is ParseError =>
  error._tag === "UnknownCommand" ||
  error._tag === "UnknownOption" ||
  error._tag === "MissingOptionValue" ||
  error._tag === "MissingRequiredOption" ||
  error._tag === "InvalidOption" ||
  error._tag === "UnexpectedArgument"

const renderApiRequestError = (error: ApiRequestError): string =>
  error.displayOnlyMessage === true
    ? error.message
    : [
      `${error.method} ${error.path} failed`,
      error.message
    ].join("\n")

const renderHostCliError = (error: HostError): string =>
  Match.value(error).pipe(
    Match.when({ _tag: "ControllerBootstrapError" }, ({ message }) => message),
    Match.when({ _tag: "UnsupportedCommandError" }, ({ message }) => message),
    Match.when({ _tag: "ProjectResolutionError" }, ({ message }) => message),
    Match.when({ _tag: "TerminalSessionClientError" }, ({ message }) => message),
    Match.when({ _tag: "ApiAuthRequiredError" }, ({ command, message }) => [message, `Run: ${command}`].join("\n")),
    Match.when({ _tag: "ApiRequestError" }, renderApiRequestError),
    Match.orElse((unknownError) => "message" in unknownError ? unknownError.message : String(unknownError))
  )

export const renderCliError = (error: CliError): string => {
  if (isParseError(error)) {
    return formatParseError(error)
  }
  return renderHostCliError(error)
}
