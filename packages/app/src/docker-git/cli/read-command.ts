import { Effect, Either, pipe } from "effect"

import {
  controllerCpuLimitEnvKey,
  controllerMemoryLimitEnvKey,
  controllerPidsLimitEnvKey,
  type ControllerResourceLimitArgParse,
  controllerResourceLimitEnvAssignments,
  controllerResourceLimitsForceRecreateEnvKey,
  shouldForceRecreateForControllerResourceLimitIntent,
  stripControllerResourceLimitArgs
} from "../controller-resource-limits.js"
import { type Command, type ParseError } from "../frontend-lib/core/domain.js"

import { parseArgs } from "./parser.js"

const applyControllerResourceLimitEnv = (
  parsed: ControllerResourceLimitArgParse
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.sync(() => {
    const assignments = controllerResourceLimitEnvAssignments(parsed.controllerResourceLimits)
    const isForceRecreate = shouldForceRecreateForControllerResourceLimitIntent(parsed.controllerResourceLimits, {
      cpuLimit: process.env[controllerCpuLimitEnvKey],
      ramLimit: process.env[controllerMemoryLimitEnvKey],
      pidsLimit: process.env[controllerPidsLimitEnvKey]
    })

    for (const assignment of assignments) {
      process.env[assignment.key] = assignment.value
    }

    process.env[controllerResourceLimitsForceRecreateEnvKey] = isForceRecreate ? "1" : "0"

    return parsed.args
  })

// CHANGE: read and parse CLI arguments from process.argv
// WHY: keep IO at the boundary and delegate parsing to CORE
// QUOTE(ТЗ): "Надо написать CLI команду"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall argv: read(argv) -> parse(argv)
// PURITY: SHELL
// EFFECT: Effect<Command, ParseError, never>
// INVARIANT: errors are typed as ParseError
// COMPLEXITY: O(n) where n = |argv|
export const readCommand: Effect.Effect<Command, ParseError> = pipe(
  Effect.sync(() => process.argv.slice(2)),
  Effect.map((args) => stripControllerResourceLimitArgs(args)),
  Effect.flatMap((result) =>
    Either.match(result, {
      onLeft: (error) => Effect.fail(error),
      onRight: (parsed) => applyControllerResourceLimitEnv(parsed)
    })
  ),
  Effect.map((args) => parseArgs(args)),
  Effect.flatMap((result) =>
    Either.match(result, {
      onLeft: (error) => Effect.fail(error),
      onRight: (command) => Effect.succeed(command)
    })
  )
)
