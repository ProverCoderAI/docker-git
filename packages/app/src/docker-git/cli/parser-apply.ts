import { Either } from "effect"

import { type ApplyCommand, type ParseError } from "@effect-template/lib/core/domain"
import { normalizeCpuLimit, normalizeRamLimit } from "@effect-template/lib/core/resource-limits"

import { parseProjectDirWithOptions } from "./parser-shared.js"

// CHANGE: parse "apply" command for existing docker-git projects
// WHY: update managed docker-git config on the current project/container without creating a new project
// QUOTE(ТЗ): "Не создавать новый... а прямо в текущем обновить её на актуальную"
// REF: issue-72-followup-apply-current-config
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseApply(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<ApplyCommand, ParseError, never>
// INVARIANT: projectDir is never empty
// COMPLEXITY: O(n) where n = |argv|
export const parseApply = (
  args: ReadonlyArray<string>
): Either.Either<ApplyCommand, ParseError> =>
  Either.gen(function*(_) {
    const { projectDir, raw } = yield* _(parseProjectDirWithOptions(args))
    const cpuLimit = yield* _(normalizeCpuLimit(raw.cpuLimit, "--cpu"))
    const ramLimit = yield* _(normalizeRamLimit(raw.ramLimit, "--ram"))
    return {
      _tag: "Apply",
      projectDir,
      runUp: raw.up ?? true,
      gitTokenLabel: raw.gitTokenLabel,
      codexTokenLabel: raw.codexTokenLabel,
      claudeTokenLabel: raw.claudeTokenLabel,
      cpuLimit,
      ramLimit,
      enableMcpPlaywright: raw.enableMcpPlaywright
    }
  })
