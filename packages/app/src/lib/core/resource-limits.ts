import { Either } from "effect"

import { defaultCpuLimit, defaultRamLimit, type ParseError, type TemplateConfig } from "./domain.js"

const mebibyte = 1024 ** 2
const minimumResolvedCpuLimit = 0.25
const minimumResolvedRamLimitMib = 512
const precisionScale = 100

type HostResources = {
  readonly cpuCount: number
  readonly totalMemoryBytes: number
}

export type ResolvedComposeResourceLimits = {
  readonly cpuLimit: number
  readonly ramLimit: string
}

const cpuAbsolutePattern = /^\d+(?:\.\d+)?$/u
const ramAbsolutePattern = /^\d+(?:\.\d+)?(?:b|k|kb|m|mb|g|gb|t|tb)$/iu
const percentPattern = /^\d+(?:\.\d+)?%$/u

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
  ramLimit: template.ramLimit ?? defaultRamLimit
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

export const resolveComposeResourceLimits = (
  template: Pick<TemplateConfig, "cpuLimit" | "ramLimit">,
  hostResources: HostResources
): ResolvedComposeResourceLimits => {
  const cpuLimitIntent = template.cpuLimit ?? defaultCpuLimit
  const ramLimitIntent = template.ramLimit ?? defaultRamLimit
  const cpuPercent = parsePercent(cpuLimitIntent)
  const ramPercent = parsePercent(ramLimitIntent)

  return {
    cpuLimit: cpuPercent === null
      ? Number(cpuLimitIntent)
      : resolvePercentCpuLimit(cpuPercent, hostResources.cpuCount),
    ramLimit: ramPercent === null
      ? ramLimitIntent
      : resolvePercentRamLimit(ramPercent, hostResources.totalMemoryBytes)
  }
}
