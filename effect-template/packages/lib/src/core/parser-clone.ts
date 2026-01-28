import { Either } from "effect"

import {
  type Command,
  defaultTemplateConfig,
  deriveRepoPathParts,
  type ParseError,
  resolveRepoInput
} from "./domain.js"
import { buildCreateCommand, nonEmpty } from "./parser-create.js"
import { parseRawOptions, type RawOptions } from "./parser-options.js"

const applyCloneDefaults = (raw: RawOptions, repoUrl: string): RawOptions => {
  const repoPath = deriveRepoPathParts(repoUrl).pathParts.join("/")
  const sshUser = raw.sshUser?.trim() ?? defaultTemplateConfig.sshUser
  const homeDir = `/home/${sshUser}`
  return {
    ...raw,
    repoUrl,
    outDir: raw.outDir ?? `.docker-git/${repoPath}`,
    targetDir: raw.targetDir ?? `${homeDir}/${repoPath}`
  }
}

// CHANGE: parse clone command with positional repo url
// WHY: allow "docker-git clone <url>" to build + run a container
// QUOTE(ТЗ): "docker-git clone url"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseClone(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<Command, ParseError, never>
// INVARIANT: first positional arg is treated as repo url
// COMPLEXITY: O(n) where n = |argv|
export const parseClone = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> => {
  const first = args[0]
  const positionalRepoUrl = first !== undefined && !first.startsWith("-") ? first : undefined
  const restArgs = positionalRepoUrl ? args.slice(1) : args

  return Either.gen(function*(_) {
    const raw = yield* _(parseRawOptions(restArgs))
    const rawRepoUrl = yield* _(nonEmpty("--repo-url", raw.repoUrl ?? positionalRepoUrl))
    const resolvedRepo = resolveRepoInput(rawRepoUrl)
    const withDefaults = applyCloneDefaults(raw, resolvedRepo.repoUrl)
    const withRef = resolvedRepo.repoRef !== undefined && raw.repoRef === undefined
      ? { ...withDefaults, repoRef: resolvedRepo.repoRef }
      : withDefaults
    const create = yield* _(buildCreateCommand(withRef))
    return { ...create, waitForClone: true }
  })
}
