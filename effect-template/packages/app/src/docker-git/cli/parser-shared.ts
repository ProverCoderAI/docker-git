import { Either } from "effect"

import { deriveRepoPathParts, type ParseError, resolveRepoInput } from "@effect-template/lib/core/domain"

import { parseRawOptions } from "./parser-options.js"

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

export const parseProjectDirArgs = (
  args: ReadonlyArray<string>,
  defaultProjectDir: string = "."
): Either.Either<{ readonly projectDir: string }, ParseError> =>
  Either.gen(function*(_) {
    const { positionalRepoUrl, restArgs } = splitPositionalRepo(args)
    const raw = yield* _(parseRawOptions(restArgs))
    const rawRepoUrl = raw.repoUrl ?? positionalRepoUrl
    const resolvedRepo = rawRepoUrl ? resolveRepoInput(rawRepoUrl).repoUrl : null
    const projectDir = raw.projectDir ??
      (resolvedRepo
        ? `.docker-git/${deriveRepoPathParts(resolvedRepo).pathParts.join("/")}`
        : defaultProjectDir)

    return { projectDir }
  })
