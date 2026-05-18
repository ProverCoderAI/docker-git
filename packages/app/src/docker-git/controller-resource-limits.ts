import { Either, Match } from "effect"

import type { ParseError } from "./frontend-lib/core/domain.js"
import {
  normalizeCpuLimit,
  normalizeRamLimit,
  resolveComposeResourceLimits
} from "./frontend-lib/core/resource-limits.js"

export const controllerCpuLimitEnvKey = "DOCKER_GIT_CONTROLLER_CPUS"
export const controllerMemoryLimitEnvKey = "DOCKER_GIT_CONTROLLER_MEMORY"
export const controllerMemorySwapLimitEnvKey = "DOCKER_GIT_CONTROLLER_MEMORY_SWAP"
export const controllerPidsLimitEnvKey = "DOCKER_GIT_CONTROLLER_PIDS"
export const controllerResourceLimitsForceRecreateEnvKey = "DOCKER_GIT_CONTROLLER_RESOURCE_LIMITS_FORCE_RECREATE"

export const defaultControllerCpuLimit = "90%"
export const defaultControllerRamLimit = "90%"
export const defaultControllerPidsLimit = "4096"

export const controllerCpuOption = "--controller-cpu"
export const controllerRamOption = "--controller-ram"
export const controllerPidsOption = "--controller-pids"

type HostResources = {
  readonly cpuCount: number
  readonly totalMemoryBytes: number
}

export type ControllerResourceLimitIntent = {
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly pidsLimit?: string | undefined
}

export type ControllerResourceLimitEnv = {
  readonly cpus: string
  readonly memory: string
  readonly memorySwap: string
  readonly pids: string
}

export type ControllerResourceLimitArgParse = {
  readonly args: ReadonlyArray<string>
  readonly controllerResourceLimits: ControllerResourceLimitIntent
}

type ControllerResourceLimitKey = "cpuLimit" | "ramLimit" | "pidsLimit"

type ControllerValueOptionSpec = {
  readonly flag: string
  readonly key: ControllerResourceLimitKey
}

type EnvAssignment = {
  readonly key: string
  readonly value: string
}

const controllerValueOptionSpecs: ReadonlyArray<ControllerValueOptionSpec> = [
  { flag: "--controller-cpu", key: "cpuLimit" },
  { flag: "--controller-cpus", key: "cpuLimit" },
  { flag: "--controller-ram", key: "ramLimit" },
  { flag: "--controller-memory", key: "ramLimit" },
  { flag: "--controller-pids", key: "pidsLimit" }
]

const controllerValueOptionSpecByFlag: ReadonlyMap<string, ControllerValueOptionSpec> = new Map(
  controllerValueOptionSpecs.map((spec) => [spec.flag, spec])
)

const pidsLimitPattern = /^[1-9]\d*$/u

const rewriteInvalidOption = (error: ParseError, option: string): ParseError =>
  error._tag === "InvalidOption"
    ? { _tag: "InvalidOption", option, reason: error.reason }
    : error

const requireNormalizedValue = (
  value: string | undefined,
  option: string
): Either.Either<string, ParseError> =>
  value === undefined
    ? Either.left({ _tag: "MissingOptionValue", option })
    : Either.right(value)

const normalizeControllerMeasuredLimit = (
  normalize: (value: string, option: string) => Either.Either<string | undefined, ParseError>,
  value: string,
  option: string
): Either.Either<string, ParseError> => {
  const normalized = normalize(value, option)
  if (Either.isLeft(normalized)) {
    return Either.left(rewriteInvalidOption(normalized.left, option))
  }
  return requireNormalizedValue(normalized.right, option)
}

const normalizeControllerCpuLimit = (
  value: string,
  option: string
): Either.Either<string, ParseError> => normalizeControllerMeasuredLimit(normalizeCpuLimit, value, option)

const normalizeControllerRamLimit = (
  value: string,
  option: string
): Either.Either<string, ParseError> => normalizeControllerMeasuredLimit(normalizeRamLimit, value, option)

const normalizeControllerPidsLimit = (
  value: string,
  option: string
): Either.Either<string, ParseError> => {
  const candidate = value.trim()
  if (!pidsLimitPattern.test(candidate)) {
    return Either.left({
      _tag: "InvalidOption",
      option,
      reason: "expected positive integer PID limit like 4096"
    })
  }
  return Either.right(candidate)
}

const nonEmptyOrDefault = (value: string | undefined, defaultValue: string): string => {
  const candidate = value?.trim() ?? ""
  return candidate.length === 0 ? defaultValue : candidate
}

const normalizeControllerValue = (
  key: ControllerResourceLimitKey,
  value: string,
  option: string
): Either.Either<string, ParseError> =>
  Match.value(key).pipe(
    Match.when("cpuLimit", () => normalizeControllerCpuLimit(value, option)),
    Match.when("ramLimit", () => normalizeControllerRamLimit(value, option)),
    Match.when("pidsLimit", () => normalizeControllerPidsLimit(value, option)),
    Match.exhaustive
  )

const withControllerValue = (
  intent: ControllerResourceLimitIntent,
  key: ControllerResourceLimitKey,
  value: string
): ControllerResourceLimitIntent =>
  Match.value(key).pipe(
    Match.when("cpuLimit", () => ({ ...intent, cpuLimit: value })),
    Match.when("ramLimit", () => ({ ...intent, ramLimit: value })),
    Match.when("pidsLimit", () => ({ ...intent, pidsLimit: value })),
    Match.exhaustive
  )

const applyControllerValueOption = (
  intent: ControllerResourceLimitIntent,
  spec: ControllerValueOptionSpec,
  value: string
): Either.Either<ControllerResourceLimitIntent, ParseError> => {
  const normalized = normalizeControllerValue(spec.key, value, spec.flag)
  if (Either.isLeft(normalized)) {
    return Either.left(normalized.left)
  }
  return Either.right(withControllerValue(intent, spec.key, normalized.right))
}

const splitInlineControllerValueToken = (
  token: string
): { readonly flag: string; readonly value: string } | null => {
  if (!token.startsWith("-")) {
    return null
  }

  const equalIndex = token.indexOf("=")
  return equalIndex <= 0
    ? null
    : { flag: token.slice(0, equalIndex), value: token.slice(equalIndex + 1) }
}

const parseInlineControllerValueToken = (
  token: string
): { readonly spec: ControllerValueOptionSpec; readonly value: string } | null => {
  const inline = splitInlineControllerValueToken(token)
  if (inline === null) {
    return null
  }

  const spec = controllerValueOptionSpecByFlag.get(inline.flag)
  if (spec === undefined) {
    return null
  }

  return { spec, value: inline.value }
}

export const hasControllerResourceLimitOverrides = (
  intent: ControllerResourceLimitIntent
): boolean => intent.cpuLimit !== undefined || intent.ramLimit !== undefined || intent.pidsLimit !== undefined

// CHANGE: decide whether resource-limit intent changes require controller recreate.
// WHY: compose applies caps only at container creation, so CLI/env overrides must bypass healthy-controller reuse.
// QUOTE(ТЗ): "можно настраивать и больше и меньше с помощью cli параметров"
// REF: issue-260-pr-comment-4429205358
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/263#issuecomment-4429205358
// FORMAT THEOREM: hasOverrides(cli) || hasOverrides(env) -> recreate(controller)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: no configured limit intent is silently ignored by controller reuse
// COMPLEXITY: O(1)
export const shouldForceRecreateForControllerResourceLimitIntent = (
  cliIntent: ControllerResourceLimitIntent,
  envIntent: ControllerResourceLimitIntent
): boolean => hasControllerResourceLimitOverrides(cliIntent) || hasControllerResourceLimitOverrides(envIntent)

export const controllerResourceLimitEnvAssignments = (
  intent: ControllerResourceLimitIntent
): ReadonlyArray<EnvAssignment> => [
  ...(intent.cpuLimit === undefined ? [] : [{ key: controllerCpuLimitEnvKey, value: intent.cpuLimit }]),
  ...(intent.ramLimit === undefined ? [] : [{ key: controllerMemoryLimitEnvKey, value: intent.ramLimit }]),
  ...(intent.pidsLimit === undefined ? [] : [{ key: controllerPidsLimitEnvKey, value: intent.pidsLimit }]),
  ...(hasControllerResourceLimitOverrides(intent)
    ? [{ key: controllerResourceLimitsForceRecreateEnvKey, value: "1" }]
    : [])
]

// CHANGE: strip controller-specific resource flags before normal command parsing.
// WHY: controller limits are global bootstrap options, not per-project template options.
// QUOTE(ТЗ): "можно настраивать и больше и меньше с помощью cli параметров"
// REF: issue-260-pr-comment-4429205358
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/263#issuecomment-4429205358
// FORMAT THEOREM: forall argv: strip(argv).args contains no controller-limit flags
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: extracted values are normalized before reaching the shell boundary
// COMPLEXITY: O(n) where n = |argv|
export const stripControllerResourceLimitArgs = (
  args: ReadonlyArray<string>
): Either.Either<ControllerResourceLimitArgParse, ParseError> => {
  const strippedArgs: Array<string> = []
  let controllerResourceLimits: ControllerResourceLimitIntent = {}
  let index = 0

  while (index < args.length) {
    const token = args[index] ?? ""
    const inline = parseInlineControllerValueToken(token)
    if (inline !== null) {
      const parsed = applyControllerValueOption(controllerResourceLimits, inline.spec, inline.value)
      if (Either.isLeft(parsed)) {
        return Either.left(parsed.left)
      }
      controllerResourceLimits = parsed.right
      index += 1
      continue
    }

    const spec = controllerValueOptionSpecByFlag.get(token)
    if (spec !== undefined) {
      const value = args[index + 1]
      if (value === undefined) {
        return Either.left({ _tag: "MissingOptionValue", option: token })
      }
      const parsed = applyControllerValueOption(controllerResourceLimits, spec, value)
      if (Either.isLeft(parsed)) {
        return Either.left(parsed.left)
      }
      controllerResourceLimits = parsed.right
      index += 2
      continue
    }

    strippedArgs.push(token)
    index += 1
  }

  return Either.right({
    args: strippedArgs,
    controllerResourceLimits
  })
}

// CHANGE: resolve controller resource intent into Docker Compose-compatible values.
// WHY: compose cannot consume percentage memory limits, so percentages must be resolved at the host boundary.
// QUOTE(ТЗ): "по дефолту он должен иметь возможность к 90% лимитов"
// REF: issue-260-pr-comment-4429205358
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/263#issuecomment-4429205358
// FORMAT THEOREM: forall host: cpu=90% -> cpus=0.9*host.cpuCount, ram=90% -> memory=floor(0.9*host.ramMiB)m
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returned cpus/memory/pids are valid docker compose resource values
// COMPLEXITY: O(1)
export const resolveControllerResourceLimitEnv = (
  intent: ControllerResourceLimitIntent,
  hostResources: HostResources
): Either.Either<ControllerResourceLimitEnv, ParseError> =>
  Either.gen(function*(_) {
    const cpuLimit = yield* _(
      normalizeControllerCpuLimit(nonEmptyOrDefault(intent.cpuLimit, defaultControllerCpuLimit), controllerCpuOption)
    )
    const ramLimit = yield* _(
      normalizeControllerRamLimit(nonEmptyOrDefault(intent.ramLimit, defaultControllerRamLimit), controllerRamOption)
    )
    const pidsLimit = yield* _(
      normalizeControllerPidsLimit(
        nonEmptyOrDefault(intent.pidsLimit, defaultControllerPidsLimit),
        controllerPidsOption
      )
    )
    const resolved = resolveComposeResourceLimits({ cpuLimit, ramLimit }, hostResources)

    return {
      cpus: String(resolved.cpuLimit),
      memory: resolved.ramLimit,
      memorySwap: resolved.swapLimit,
      pids: pidsLimit
    }
  })
