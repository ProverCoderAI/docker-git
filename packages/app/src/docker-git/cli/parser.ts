import { Either, Match } from "effect"

import { type Command, type ParseError } from "../frontend-lib/core/domain.js"

import { parseApply } from "./parser-apply.js"
import { parseAttach } from "./parser-attach.js"
import { parseAuth } from "./parser-auth.js"
import { parseClone } from "./parser-clone.js"
import { buildCreateCommand } from "./parser-create.js"
import { parseMcpPlaywright } from "./parser-mcp-playwright.js"
import { parseOpen } from "./parser-open.js"
import { parseRawOptions } from "./parser-options.js"
import { parsePanes } from "./parser-panes.js"
import { parseScrap } from "./parser-scrap.js"
import { parseSessions } from "./parser-sessions.js"
import { parseState } from "./parser-state.js"
import { usageText } from "./usage.js"

const isHelpFlag = (token: string): boolean => token === "--help" || token === "-h"

const helpCommand: Command = { _tag: "Help", message: usageText }
const menuCommand: Command = { _tag: "Menu" }
const statusCommand: Command = { _tag: "Status" }
const downAllCommand: Command = { _tag: "DownAll" }
const browserDaemonFlags = new Set(["-d", "--daemon"])

// CHANGE: parse browser daemon mode without side effects.
// WHY: CLI intent must be a typed pure value before the shell starts web processes.
// QUOTE(ТЗ): "Run browser with support dameon mode, like a flag -d"
// REF: issue-373
// SOURCE: n/a
// FORMAT THEOREM: forall args: daemon(parseBrowser(args)) <-> exists a in args: a in {"-d","--daemon"}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: browser foreground mode is the default when no daemon flag is present
// COMPLEXITY: O(n)/O(1) where n = |args|
const parseBrowser = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> =>
  Either.right({ _tag: "Browser", daemon: args.some((arg) => browserDaemonFlags.has(arg)) })

// CHANGE: parse --active flag for apply-all command to restrict to running containers
// WHY: allow users to apply config only to currently active containers via --active flag
// QUOTE(ТЗ): "сделать это возможным через атрибут --active применять только к активным контейнерам, а не ко всем"
// REF: issue-185
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: activeOnly is true only when --active flag is present
// COMPLEXITY: O(n) where n = |args|
const parseApplyAll = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> => {
  const activeOnly = args.includes("--active")
  const command: Command = { _tag: "ApplyAll", activeOnly }
  return Either.right(command)
}

const parseCreate = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> =>
  Either.flatMap(parseRawOptions(args), (raw) => buildCreateCommand(raw))

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

  return Match.value(command)
    .pipe(
      Match.when("create", () => parseCreate(rest)),
      Match.when("init", () => parseCreate(rest)),
      Match.when("clone", () => parseClone(rest)),
      Match.when("attach", () => parseAttach(rest)),
      Match.when("tmux", () => parseAttach(rest)),
      Match.when("panes", () => parsePanes(rest)),
      Match.when("terms", () => parsePanes(rest)),
      Match.when("terminals", () => parsePanes(rest)),
      Match.when("sessions", () => parseSessions(rest)),
      Match.when("scrap", () => parseScrap(rest)),
      Match.when("mcp-playwright", () => parseMcpPlaywright(rest)),
      Match.when("help", () => Either.right(helpCommand)),
      Match.when("ps", () => Either.right(statusCommand)),
      Match.when("status", () => Either.right(statusCommand)),
      Match.when("down-all", () => Either.right(downAllCommand)),
      Match.when("stop-all", () => Either.right(downAllCommand)),
      Match.when("kill-all", () => Either.right(downAllCommand)),
      Match.when("menu", () => Either.right(menuCommand)),
      Match.when("ui", () => Either.right(menuCommand))
    )
    .pipe(
      Match.when("browser", () => parseBrowser(rest)),
      Match.when("web", () => parseBrowser(rest)),
      Match.when("apply-all", () => parseApplyAll(rest)),
      Match.when("update-all", () => parseApplyAll(rest)),
      Match.when("auth", () => parseAuth(rest)),
      Match.when("open", () => parseOpen(rest)),
      Match.when("apply", () => parseApply(rest)),
      Match.when("state", () => parseState(rest)),
      Match.orElse(() => Either.left(unknownCommandError))
    )
}
