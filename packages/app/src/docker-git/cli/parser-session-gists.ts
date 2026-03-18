import { Either, Match } from "effect"

import {
  type ParseError,
  type SessionGistBackupCommand,
  type SessionGistCommand,
  type SessionGistDownloadCommand,
  type SessionGistListCommand,
  type SessionGistViewCommand
} from "@effect-template/lib/core/domain"

import { parsePositiveInt, parseProjectDirWithOptions, splitSubcommand } from "./parser-shared.js"

// CHANGE: parse session backup commands for backup/list/view/download
// WHY: enables CLI access to session backup repository functionality
// QUOTE(ТЗ): "иметь возможность возвращаться ко всем старым сессиям с агентами"
// REF: issue-143
// PURITY: CORE
// EFFECT: Either<SessionGistCommand, ParseError>
// INVARIANT: all subcommands are deterministically parsed
// COMPLEXITY: O(n) where n = |args|

const defaultLimit = 20
const defaultOutputDir = "./.session-restore"

const missingSnapshotRefError: ParseError = { _tag: "MissingRequiredOption", option: "snapshot-ref" }

const extractSnapshotRef = (args: ReadonlyArray<string>): string | null => {
  const snapshotRef = args[0]
  return snapshotRef && !snapshotRef.startsWith("-") ? snapshotRef : null
}

const parseBackup = (
  args: ReadonlyArray<string>
): Either.Either<SessionGistBackupCommand, ParseError> =>
  Either.map(parseProjectDirWithOptions(args), ({ projectDir, raw }) => ({
    _tag: "SessionGistBackup",
    projectDir,
    prNumber: raw.prNumber ? Number.parseInt(raw.prNumber, 10) : null,
    repo: raw.repo ?? null,
    postComment: raw.noComment !== true
  }))

const parseList = (
  args: ReadonlyArray<string>
): Either.Either<SessionGistListCommand, ParseError> =>
  Either.gen(function*(_) {
    const { raw } = yield* _(parseProjectDirWithOptions(args))
    const limit = raw.limit
      ? yield* _(parsePositiveInt("--limit", raw.limit))
      : defaultLimit
    return {
      _tag: "SessionGistList",
      limit,
      repo: raw.repo ?? null
    }
  })

const parseView = (
  args: ReadonlyArray<string>
): Either.Either<SessionGistViewCommand, ParseError> => {
  const snapshotRef = extractSnapshotRef(args)
  return snapshotRef
    ? Either.right({ _tag: "SessionGistView", snapshotRef })
    : Either.left(missingSnapshotRefError)
}

const parseDownload = (
  args: ReadonlyArray<string>
): Either.Either<SessionGistDownloadCommand, ParseError> => {
  const snapshotRef = extractSnapshotRef(args)
  if (!snapshotRef) {
    return Either.left(missingSnapshotRefError)
  }
  return Either.map(parseProjectDirWithOptions(args.slice(1)), ({ raw }) => ({
    _tag: "SessionGistDownload",
    snapshotRef,
    outputDir: raw.output ?? defaultOutputDir
  }))
}

const unknownActionError = (action: string): ParseError => ({
  _tag: "InvalidOption",
  option: "session-gists",
  reason: `unknown action ${action}`
})

export const parseSessionGists = (
  args: ReadonlyArray<string>
): Either.Either<SessionGistCommand, ParseError> => {
  const { rest, subcommand } = splitSubcommand(args)
  if (subcommand === null) {
    return parseList(args)
  }

  return Match.value(subcommand).pipe(
    Match.when("backup", () => parseBackup(rest)),
    Match.when("list", () => parseList(rest)),
    Match.when("view", () => parseView(rest)),
    Match.when("download", () => parseDownload(rest)),
    Match.orElse(() => Either.left(unknownActionError(subcommand)))
  )
}
