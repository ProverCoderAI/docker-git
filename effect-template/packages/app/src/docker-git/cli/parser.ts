import { Either, Match } from "effect"

import { type Command, type ParseError } from "@effect-template/lib/core/domain"

import { parseAttach } from "./parser-attach.js"
import { parseAuth } from "./parser-auth.js"
import { parseClone } from "./parser-clone.js"
import { buildCreateCommand } from "./parser-create.js"
import { parseRawOptions } from "./parser-options.js"
import { parsePanes } from "./parser-panes.js"
import { parseSessions } from "./parser-sessions.js"
import { parseState } from "./parser-state.js"
import { usageText } from "./usage.js"

const isHelpFlag = (token: string): boolean => token === "--help" || token === "-h"

const helpCommand: Command = { _tag: "Help", message: usageText }
const menuCommand: Command = { _tag: "Menu" }
const statusCommand: Command = { _tag: "Status" }
const downAllCommand: Command = { _tag: "DownAll" }

const parseCreate = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> =>
  Either.flatMap(parseRawOptions(args), buildCreateCommand)

// CHANGE: parse CLI arguments into a typed command
// WHY: enforce deterministic, pure parsing before any effects run
// QUOTE(ТЗ): "Надо написать CLI команду с помощью которой мы будем создавать докер образы"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parse(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<Command, ParseError, never>
// INVARIANT: parse does not perform IO and returns the same result for same argv
// COMPLEXITY: O(n) where n = |argv|
export const parseArgs = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> => {
  if (args.length === 0) {
    return Either.right(menuCommand)
  }

  if (args.some((arg) => isHelpFlag(arg))) {
    return Either.right(helpCommand)
  }

  const command = args[0]
  const rest = args.slice(1)
  const unknownCommandError: ParseError = {
    _tag: "UnknownCommand",
    command: command ?? ""
  }

  return Match.value(command).pipe(
    Match.when("create", () => parseCreate(rest)),
    Match.when("init", () => parseCreate(rest)),
    Match.when("clone", () => parseClone(rest)),
    Match.when("attach", () => parseAttach(rest)),
    Match.when("tmux", () => parseAttach(rest)),
    Match.when("panes", () => parsePanes(rest)),
    Match.when("terms", () => parsePanes(rest)),
    Match.when("terminals", () => parsePanes(rest)),
    Match.when("sessions", () => parseSessions(rest)),
    Match.when("help", () => Either.right(helpCommand)),
    Match.when("ps", () => Either.right(statusCommand)),
    Match.when("status", () => Either.right(statusCommand)),
    Match.when("down-all", () => Either.right(downAllCommand)),
    Match.when("stop-all", () => Either.right(downAllCommand)),
    Match.when("kill-all", () => Either.right(downAllCommand)),
    Match.when("menu", () => Either.right(menuCommand)),
    Match.when("ui", () => Either.right(menuCommand)),
    Match.when("auth", () => parseAuth(rest)),
    Match.when("state", () => parseState(rest)),
    Match.orElse(() => Either.left(unknownCommandError))
  )
}
