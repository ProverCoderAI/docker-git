import { Either } from "effect"

import type { ResolvedComposeResourceLimits } from "@prover-coder-ai/docker-git-container"

import { type RawOptions } from "./command-options.js"
import {
  defaultCpuLimit,
  defaultPlaywrightCpuLimit,
  defaultPlaywrightRamLimit,
  defaultRamLimit,
  type ParseError,
  type TemplateConfig
} from "./domain.js"

const mebibyte = 1024 ** 2
const minimumResolvedCpuLimit = 0.25
const minimumResolvedRamLimitMib = 512
const minimumResolvedSwapLimitMib = 1
const precisionScale = 100

type HostResources = {
  readonly cpuCount: number
  readonly totalMemoryBytes: number
}

// CHANGE: source the resolved compose limit shape from the container package (issue #412)
// WHY: docker-compose rendering owns this contract in @prover-coder-ai/docker-git-container; the backend
//      re-exports it so existing "./resource-limits.js" consumers keep a single source of truth.
// REF: issue-412

const cpuAbsolutePattern = /^\d+(?:\.\d+)?$/u
const ramLimitPattern = /^(\d+(?:\.\d+)?)(b|k|kb|m|mb|g|gb|t|tb)$/iu
const ramAbsolutePattern = /^\d+(?:\.\d+)?(?:b|k|kb|m|mb|g|gb|t|tb)$/iu
const percentPattern = /^\d+(?:\.\d+)?%$/u

const ramUnitMibFactors: Readonly<Record<string, number>> = {
  b: 1 / mebibyte,
  k: 1 / 1024,
  kb: 1 / 1024,
  m: 1,
  mb: 1,
  g: 1024,
  gb: 1024,
  t: 1024 * 1024,
  tb: 1024 * 1024
}

const normalizePrecision = (value: number): number => Math.round(value * precisionScale) / precisionScale

const missingLimit = (): string | undefined => undefined

const parsePercent = (candidate: string): number | null => {
  if (!percentPattern.test(candidate)) {
    return null
  }
  const parsed = Number(candidate.slice(0, -1))
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    return null
  }
  return normalizePrecision(parsed)
}

const percentReason = (kind: "cpu" | "ram"): string =>
  kind === "cpu"
    ? "expected CPU like 30% or 1.5"
    : "expected RAM like 30%, 512m or 4g"

const normalizePercent = (candidate: string, kind: "cpu" | "ram"): Either.Either<string, ParseError> => {
  const parsed = parsePercent(candidate)
  if (parsed === null) {
    return Either.left({
      _tag: "InvalidOption",
      option: kind === "cpu" ? "--cpu" : "--ram",
      reason: percentReason(kind)
    })
  }
  return Either.right(`${parsed}%`)
}

export const normalizeCpuLimit = (
  value: string | undefined,
  option: string
): Either.Either<string | undefined, ParseError> => {
  const candidate = value?.trim().toLowerCase() ?? ""
  if (candidate.length === 0) {
    return Either.right(missingLimit())
  }
  if (candidate.endsWith("%")) {
    return normalizePercent(candidate, "cpu")
  }
  if (!cpuAbsolutePattern.test(candidate)) {
    return Either.left({
      _tag: "InvalidOption",
      option,
      reason: "expected CPU like 30% or 1.5"
    })
  }
  const parsed = Number(candidate)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Either.left({
      _tag: "InvalidOption",
      option,
      reason: "must be greater than 0"
    })
  }
  return Either.right(String(normalizePrecision(parsed)))
}

export const normalizeRamLimit = (
  value: string | undefined,
  option: string
): Either.Either<string | undefined, ParseError> => {
  const candidate = value?.trim().toLowerCase() ?? ""
  if (candidate.length === 0) {
    return Either.right(missingLimit())
  }
  if (candidate.endsWith("%")) {
    return normalizePercent(candidate, "ram")
  }
  if (!ramAbsolutePattern.test(candidate)) {
    return Either.left({
      _tag: "InvalidOption",
      option,
      reason: "expected RAM like 30%, 512m or 4g"
    })
  }
  return Either.right(candidate)
}

export const withDefaultResourceLimitIntent = (
  template: TemplateConfig
): TemplateConfig => ({
  ...template,
  cpuLimit: template.cpuLimit ?? defaultCpuLimit,
  ramLimit: template.ramLimit ?? defaultRamLimit,
  playwrightCpuLimit: template.playwrightCpuLimit ?? defaultPlaywrightCpuLimit,
  playwrightRamLimit: template.playwrightRamLimit ?? defaultPlaywrightRamLimit
})

const resolvePercentCpuLimit = (percent: number, cpuCount: number): number =>
  Math.max(
    minimumResolvedCpuLimit,
    normalizePrecision((Math.max(1, cpuCount) * percent) / 100)
  )

const resolvePercentRamLimit = (percent: number, totalMemoryBytes: number): string => {
  const totalMib = Math.max(minimumResolvedRamLimitMib, Math.floor(totalMemoryBytes / mebibyte))
  const targetMib = Math.max(minimumResolvedRamLimitMib, Math.floor((totalMib * percent) / 100))
  return `${targetMib}m`
}

const parseRamLimitMib = (value: string): number | null => {
  const match = ramLimitPattern.exec(value)
  if (match === null) {
    return null
  }

  const amount = Number(match[1] ?? "0")
  const unit = (match[2] ?? "m").toLowerCase()
  const factor = ramUnitMibFactors[unit]
  return !Number.isFinite(amount) || amount <= 0 || factor === undefined
    ? null
    : amount * factor
}

// CHANGE: allow project containers to use WSL swap without removing hard RAM limits
// WHY: Docker Compose `memswap_limit` is RAM+swap total; setting it equal to RAM disables extra swap
// SOURCE: n/a
// FORMAT THEOREM: forall r: valid_ram(r) -> swap_limit(r) >= 2 * ram_limit(r)
// PURITY: CORE
// INVARIANT: generated containers keep a finite memory+swap ceiling
// COMPLEXITY: O(1)/O(1)
const resolveSwapLimit = (ramLimit: string): string => {
  const ramMib = parseRamLimitMib(ramLimit)
  return ramMib === null
    ? ramLimit
    : `${Math.max(minimumResolvedSwapLimitMib, Math.ceil(ramMib * 2))}m`
}

export const resolveComposeResourceLimits = (
  template: Pick<TemplateConfig, "cpuLimit" | "ramLimit">,
  hostResources: HostResources
): ResolvedComposeResourceLimits => {
  const cpuLimitIntent = template.cpuLimit ?? defaultCpuLimit
  const ramLimitIntent = template.ramLimit ?? defaultRamLimit
  const cpuPercent = parsePercent(cpuLimitIntent)
  const ramPercent = parsePercent(ramLimitIntent)

  const ramLimit = ramPercent === null
    ? ramLimitIntent
    : resolvePercentRamLimit(ramPercent, hostResources.totalMemoryBytes)

  return {
    cpuLimit: cpuPercent === null
      ? Number(cpuLimitIntent)
      : resolvePercentCpuLimit(cpuPercent, hostResources.cpuCount),
    ramLimit,
    swapLimit: resolveSwapLimit(ramLimit)
  }
}

export const resolvePlaywrightComposeResourceLimits = (
  template: Pick<TemplateConfig, "playwrightCpuLimit" | "playwrightRamLimit" | "cpuLimit" | "ramLimit">,
  hostResources: HostResources
): ResolvedComposeResourceLimits =>
  resolveComposeResourceLimits(
    {
      cpuLimit: template.playwrightCpuLimit ?? template.cpuLimit ?? defaultPlaywrightCpuLimit,
      ramLimit: template.playwrightRamLimit ?? template.ramLimit ?? defaultPlaywrightRamLimit
    },
    hostResources
  )

export type ResolvedResourceLimitsIntent = {
  readonly cpuLimit: string | undefined
  readonly ramLimit: string | undefined
  readonly playwrightCpuLimit: string | undefined
  readonly playwrightRamLimit: string | undefined
}

export const resolveResourceLimitsIntent = (
  raw: RawOptions
): Either.Either<ResolvedResourceLimitsIntent, ParseError> =>
  Either.gen(function*(_) {
    const cpuLimit = yield* _(normalizeCpuLimit(raw.cpuLimit ?? defaultCpuLimit, "--cpu"))
    const ramLimit = yield* _(normalizeRamLimit(raw.ramLimit ?? defaultRamLimit, "--ram"))
    const playwrightCpuLimit = yield* _(
      normalizeCpuLimit(raw.playwrightCpuLimit ?? cpuLimit, "--playwright-cpu")
    )
    const playwrightRamLimit = yield* _(
      normalizeRamLimit(raw.playwrightRamLimit ?? ramLimit, "--playwright-ram")
    )
    return { cpuLimit, ramLimit, playwrightCpuLimit, playwrightRamLimit }
  })

export { type ResolvedComposeResourceLimits } from "@prover-coder-ai/docker-git-container"
