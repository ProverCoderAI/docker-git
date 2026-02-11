import { Either } from "effect"

import { deriveRepoPathParts, type ParseError, resolveRepoInput } from "@effect-template/lib/core/domain"

import { parseRawOptions, type RawOptions } from "./parser-options.js"

type PositionalRepo = {
  readonly positionalRepoUrl: string | undefined
  readonly restArgs: ReadonlyArray<string>
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
    const resolvedRepo = rawRepoUrl ? resolveRepoInput(rawRepoUrl) : null
    const repoPath = resolvedRepo
      ? (() => {
          const baseParts = deriveRepoPathParts(resolvedRepo.repoUrl).pathParts
          const projectParts = resolvedRepo.workspaceSuffix
            ? [...baseParts, resolvedRepo.workspaceSuffix]
            : baseParts
          return projectParts.join("/")
        })()
      : null
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
