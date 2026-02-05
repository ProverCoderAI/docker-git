import { Either, Match } from "effect"

import { type ParseError, type SessionsCommand } from "@effect-template/lib/core/domain"

import { parseProjectDirWithOptions } from "./parser-shared.js"

const defaultLines = 200

const parsePositiveInt = (
  option: string,
  raw: string
): Either.Either<number, ParseError> => {
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    const error: ParseError = {
      _tag: "InvalidOption",
      option,
      reason: "expected positive integer"
    }
    return Either.left(error)
  }
  return Either.right(value)
}

const parseList = (args: ReadonlyArray<string>): Either.Either<SessionsCommand, ParseError> =>
  Either.map(parseProjectDirWithOptions(args), ({ projectDir, raw }) => ({
    _tag: "SessionsList",
    projectDir,
    includeDefault: raw.includeDefault === true
  }))

const parsePidContext = (
  args: ReadonlyArray<string>
): Either.Either<
  { readonly pid: number; readonly projectDir: string; readonly raw: { readonly lines?: string } },
  ParseError
> =>
  Either.gen(function*(_) {
    const pidRaw = args[0]
    if (!pidRaw) {
      const error: ParseError = { _tag: "MissingRequiredOption", option: "pid" }
      return yield* _(Either.left(error))
    }
    const pid = yield* _(parsePositiveInt("pid", pidRaw))
    const { projectDir, raw } = yield* _(parseProjectDirWithOptions(args.slice(1)))
    return { pid, projectDir, raw }
  })

const parseKill = (args: ReadonlyArray<string>): Either.Either<SessionsCommand, ParseError> =>
  Either.map(parsePidContext(args), ({ pid, projectDir }) => ({
    _tag: "SessionsKill",
    projectDir,
    pid
  }))

const parseLogs = (args: ReadonlyArray<string>): Either.Either<SessionsCommand, ParseError> =>
  Either.gen(function*(_) {
    const { pid, projectDir, raw } = yield* _(parsePidContext(args))
    const lines = raw.lines ? yield* _(parsePositiveInt("--lines", raw.lines)) : defaultLines
    return { _tag: "SessionsLogs", projectDir, pid, lines }
  })

// CHANGE: parse sessions command into list/kill/logs actions
// WHY: surface container terminal sessions and background processes from CLI
// QUOTE(ТЗ): "CLI команду которая из докера вернёт запущенные терминал сессии"
// REF: user-request-2026-02-04-terminal-sessions
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseSessions(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<SessionsCommand, ParseError, never>
// INVARIANT: pid/lines must be positive integers
// COMPLEXITY: O(n) where n = |argv|
export const parseSessions = (
  args: ReadonlyArray<string>
): Either.Either<SessionsCommand, ParseError> => {
  if (args.length === 0) {
    return parseList(args)
  }

  const first = args[0] ?? ""
  if (first.startsWith("-")) {
    return parseList(args)
  }

  const rest = args.slice(1)
  return Match.value(first).pipe(
    Match.when("list", () => parseList(rest)),
    Match.when("kill", () => parseKill(rest)),
    Match.when("stop", () => parseKill(rest)),
    Match.when("logs", () => parseLogs(rest)),
    Match.when("log", () => parseLogs(rest)),
    Match.orElse(() => {
      const error: ParseError = {
        _tag: "InvalidOption",
        option: "sessions",
        reason: `unknown action ${first}`
      }
      return Either.left(error)
    })
  )
}
