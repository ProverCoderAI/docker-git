import { Either, Match } from "effect"

import type { Command, ParseError } from "@effect-template/lib/core/domain"

import { parseRawOptions } from "./parser-options.js"

const invalidStateAction = (value: string): ParseError => ({
  _tag: "InvalidOption",
  option: "state",
  reason: `unknown action: ${value}`
})

const unexpectedArgs = (value: string): Either.Either<Command, ParseError> =>
  Either.left({ _tag: "UnexpectedArgument", value })

const parseStateInit = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> =>
  Either.flatMap(parseRawOptions(args), (raw) => {
    const repoUrl = raw.repoUrl?.trim()
    if (!repoUrl || repoUrl.length === 0) {
      return Either.left({ _tag: "MissingRequiredOption", option: "--repo-url" })
    }
    return Either.right({
      _tag: "StateInit",
      repoUrl,
      repoRef: raw.repoRef?.trim() && raw.repoRef.trim().length > 0 ? raw.repoRef.trim() : "main"
    })
  })

const parseStateCommit = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> =>
  Either.flatMap(parseRawOptions(args), (raw) => {
    const message = raw.message?.trim()
    if (!message || message.length === 0) {
      return Either.left({ _tag: "MissingRequiredOption", option: "--message" })
    }
    return Either.right({ _tag: "StateCommit", message })
  })

const parseStateSync = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> =>
  Either.map(parseRawOptions(args), (raw) => {
    const message = raw.message?.trim()
    return { _tag: "StateSync", message: message && message.length > 0 ? message : null }
  })

export const parseState = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> => {
  const action = args[0]?.trim()
  if (!action || action.length === 0) {
    return Either.left({ _tag: "MissingRequiredOption", option: "state <action>" })
  }

  const rest = args.slice(1)

  return Match.value(action).pipe(
    Match.when("path", () => {
      if (rest.length > 0) {
        return unexpectedArgs(rest[0] ?? "")
      }
      const command: Command = { _tag: "StatePath" }
      return Either.right(command)
    }),
    Match.when("init", () => parseStateInit(rest)),
    Match.when("pull", () => {
      if (rest.length > 0) {
        return unexpectedArgs(rest[0] ?? "")
      }
      const command: Command = { _tag: "StatePull" }
      return Either.right(command)
    }),
    Match.when("push", () => {
      if (rest.length > 0) {
        return unexpectedArgs(rest[0] ?? "")
      }
      const command: Command = { _tag: "StatePush" }
      return Either.right(command)
    }),
    Match.when("status", () => {
      if (rest.length > 0) {
        return unexpectedArgs(rest[0] ?? "")
      }
      const command: Command = { _tag: "StateStatus" }
      return Either.right(command)
    }),
    Match.when("commit", () => parseStateCommit(rest)),
    Match.when("sync", () => parseStateSync(rest)),
    Match.orElse(() => Either.left(invalidStateAction(action)))
  )
}
