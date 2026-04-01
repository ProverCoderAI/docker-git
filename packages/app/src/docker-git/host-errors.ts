import type { ParseError } from "@lib/core/domain"
import { formatParseError } from "./cli/usage.js"

export type ControllerBootstrapError = {
  readonly _tag: "ControllerBootstrapError"
  readonly message: string
}

export type ApiRequestError = {
  readonly _tag: "ApiRequestError"
  readonly method: string
  readonly path: string
  readonly message: string
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

export type HostError =
  | ControllerBootstrapError
  | ApiRequestError
  | ApiAuthRequiredError
  | UnsupportedCommandError

export type CliError = ParseError | HostError

const isParseError = (error: CliError): error is ParseError =>
  error._tag === "UnknownCommand" ||
  error._tag === "UnknownOption" ||
  error._tag === "MissingOptionValue" ||
  error._tag === "MissingRequiredOption" ||
  error._tag === "InvalidOption" ||
  error._tag === "UnexpectedArgument"

export const renderCliError = (error: CliError): string => {
  if (isParseError(error)) {
    return formatParseError(error)
  }

  if (error._tag === "ControllerBootstrapError") {
    return error.message
  }

  if (error._tag === "ApiAuthRequiredError") {
    return [error.message, `Run: ${error.command}`].join("\n")
  }

  if (error._tag === "UnsupportedCommandError") {
    return error.message
  }

  return [
    `${error.method} ${error.path} failed`,
    error.message
  ].join("\n")
}
