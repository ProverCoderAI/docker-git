import { Either } from "effect"

import { buildCreateCommand, nonEmpty } from "@effect-template/lib/core/command-builders"
import type { RawOptions } from "@effect-template/lib/core/command-options"
import {
  type Command,
  defaultTemplateConfig,
  type ParseError,
  resolveRepoInput
} from "@effect-template/lib/core/domain"

import { parseRawOptions } from "./parser-options.js"
import { resolveWorkspaceRepoPath, splitPositionalRepo } from "./parser-shared.js"

const applyCloneDefaults = (
  raw: RawOptions,
  rawRepoUrl: string,
  resolvedRepo: ReturnType<typeof resolveRepoInput>
): RawOptions => {
  const repoPath = resolveWorkspaceRepoPath(resolvedRepo)
  const sshUser = raw.sshUser?.trim() ?? defaultTemplateConfig.sshUser
  const homeDir = `/home/${sshUser}`
  return {
    ...raw,
    repoUrl: rawRepoUrl,
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
  const { positionalRepoUrl, restArgs } = splitPositionalRepo(args)

  return Either.gen(function*(_) {
    const raw = yield* _(parseRawOptions(restArgs))
    const rawRepoUrl = yield* _(nonEmpty("--repo-url", raw.repoUrl ?? positionalRepoUrl))
    const resolvedRepo = resolveRepoInput(rawRepoUrl)
    const withDefaults = applyCloneDefaults(raw, rawRepoUrl, resolvedRepo)
    const withRef = resolvedRepo.repoRef !== undefined && raw.repoRef === undefined
      ? { ...withDefaults, repoRef: resolvedRepo.repoRef }
      : withDefaults
    const create = yield* _(buildCreateCommand(withRef))
    return { ...create, waitForClone: true }
  })
}
