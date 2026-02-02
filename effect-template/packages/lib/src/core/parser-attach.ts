import { Either } from "effect"

import {
  type AttachCommand,
  deriveRepoPathParts,
  type ParseError,
  resolveRepoInput
} from "./domain.js"
import { parseRawOptions } from "./parser-options.js"

const defaultProjectDir = "."

// CHANGE: parse attach command into a project selection
// WHY: allow "docker-git attach" to open a tmux workspace
// QUOTE(ТЗ): "окей Давай подключим tmux"
// REF: user-request-2026-02-02-tmux
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseAttach(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<AttachCommand, ParseError, never>
// INVARIANT: projectDir is never empty
// COMPLEXITY: O(n) where n = |argv|
export const parseAttach = (args: ReadonlyArray<string>): Either.Either<AttachCommand, ParseError> => {
  const first = args[0]
  const positionalRepoUrl = first !== undefined && !first.startsWith("-") ? first : undefined
  const restArgs = positionalRepoUrl ? args.slice(1) : args

  return Either.gen(function*(_) {
    const raw = yield* _(parseRawOptions(restArgs))
    const rawRepoUrl = raw.repoUrl ?? positionalRepoUrl
    const resolvedRepo = rawRepoUrl ? resolveRepoInput(rawRepoUrl).repoUrl : null
    const projectDir =
      raw.projectDir ??
      (resolvedRepo
        ? `.docker-git/${deriveRepoPathParts(resolvedRepo).pathParts.join("/")}`
        : defaultProjectDir)

    return {
      _tag: "Attach",
      projectDir
    }
  })
}
