import { Either } from "effect"

import { deriveRepoPathParts, type ParseError, resolveRepoInput } from "@effect-template/lib/core/domain"

import { parseRawOptions, type RawOptions } from "./parser-options.js"

type PositionalRepo = {
  readonly positionalRepoUrl: string | undefined
  readonly restArgs: ReadonlyArray<string>
}

export const resolveWorkspaceRepoPath = (
  resolvedRepo: ReturnType<typeof resolveRepoInput>
): string => {
  const baseParts = deriveRepoPathParts(resolvedRepo.repoUrl).pathParts
  const projectParts = resolvedRepo.workspaceSuffix ? [...baseParts, resolvedRepo.workspaceSuffix] : baseParts
  return projectParts.join("/")
}

export const splitPositionalRepo = (args: ReadonlyArray<string>): PositionalRepo => {
  const first = args[0]
  const positionalRepoUrl = first !== undefined && !first.startsWith("-") ? first : undefined
  const restArgs = positionalRepoUrl ? args.slice(1) : args
  return { positionalRepoUrl, restArgs }
}

export const parseProjectDirWithOptions = (
  args: ReadonlyArray<string>,
  defaultProjectDir: string = "."
): Either.Either<{ readonly projectDir: string; readonly raw: RawOptions }, ParseError> =>
  Either.gen(function*(_) {
    const { positionalRepoUrl, restArgs } = splitPositionalRepo(args)
    const raw = yield* _(parseRawOptions(restArgs))
    const rawRepoUrl = raw.repoUrl ?? positionalRepoUrl
    const repoPath = rawRepoUrl ? resolveWorkspaceRepoPath(resolveRepoInput(rawRepoUrl)) : null
    const projectDir = raw.projectDir ??
      (repoPath
        ? `.docker-git/${repoPath}`
        : defaultProjectDir)

    return { projectDir, raw }
  })

export const parseProjectDirArgs = (
  args: ReadonlyArray<string>,
  defaultProjectDir: string = "."
): Either.Either<{ readonly projectDir: string }, ParseError> =>
  Either.map(
    parseProjectDirWithOptions(args, defaultProjectDir),
    ({ projectDir }) => ({ projectDir })
  )

// CHANGE: extract shared positive integer parser
// WHY: avoid code duplication across session parsers
// QUOTE(ТЗ): "иметь возможность возвращаться ко всем старым сессиям с агентами"
// REF: issue-143
// PURITY: CORE
// EFFECT: Either<number, ParseError>
// INVARIANT: returns error for non-positive integers
// COMPLEXITY: O(1)
export const parsePositiveInt = (
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

// CHANGE: shared helper to extract first arg and rest for subcommand parsing
// WHY: avoid code duplication in parser-sessions and parser-session-gists
// QUOTE(ТЗ): "иметь возможность возвращаться ко всем старым сессиям с агентами"
// REF: issue-143
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returns null subcommand if first arg starts with dash or is empty
// COMPLEXITY: O(1)
export const splitSubcommand = (
  args: ReadonlyArray<string>
): { readonly subcommand: string | null; readonly rest: ReadonlyArray<string> } => {
  const first = args[0]
  if (!first || first.startsWith("-")) {
    return { subcommand: null, rest: args }
  }
  return { subcommand: first, rest: args.slice(1) }
}
