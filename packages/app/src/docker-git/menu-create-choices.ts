import { Either } from "effect"

import { type GpuMode, isGpuMode, type ParseError } from "./frontend-lib/core/domain.js"
import { createParseError } from "./menu-create-errors.js"

export const renderExplicitBooleanChoice = (isAffirmative: boolean): string => isAffirmative ? "Y" : "N"

export const parseBooleanChoice = (input: string): boolean | null => {
  const normalized = input.trim().toLowerCase()
  if (normalized === "y" || normalized === "yes") {
    return true
  }
  if (normalized === "n" || normalized === "no") {
    return false
  }
  return null
}

export const parseExplicitBooleanChoice = parseBooleanChoice

export const parseExplicitGpuChoice = (
  input: string
): GpuMode | null => {
  const normalized = input.trim().toLowerCase()
  if (normalized === "y" || normalized === "yes") {
    return "all"
  }
  if (normalized === "n" || normalized === "no") {
    return "none"
  }
  if (isGpuMode(normalized)) {
    return normalized
  }
  return null
}

export const parseGpuInput = (
  input: string,
  fallback: GpuMode
): Either.Either<GpuMode, ParseError> => {
  const normalized = input.trim().toLowerCase()
  if (normalized.length === 0) {
    return Either.right(fallback)
  }
  if (normalized === "y" || normalized === "yes") {
    return Either.right("all")
  }
  if (normalized === "n" || normalized === "no") {
    return Either.right("none")
  }
  if (isGpuMode(normalized)) {
    return Either.right(normalized)
  }
  return Either.left(createParseError("gpu must be one of: none, all, yes, no"))
}

export const isYesDefault = (input: string, isFallback: boolean): boolean => parseBooleanChoice(input) ?? isFallback
