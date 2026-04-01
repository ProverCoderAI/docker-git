import { trimLeftChar, trimRightChar } from "./strings.js"

const trimEdgeUnderscores = (value: string): string => {
  let start = 0
  while (start < value.length && value[start] === "_") {
    start += 1
  }

  let end = value.length
  while (end > start && value[end - 1] === "_") {
    end -= 1
  }
  return value.slice(start, end)
}

const trimEdgeHyphens = (value: string): string => {
  const withoutLeading = trimLeftChar(value, "-")
  return trimRightChar(withoutLeading, "-")
}

export const normalizeGitTokenLabel = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) {
    return undefined
  }

  const normalized = trimmed
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
  const cleaned = trimEdgeUnderscores(normalized)
  if (cleaned.length === 0 || cleaned === "DEFAULT") {
    return undefined
  }
  return cleaned
}

export const normalizeAuthLabel = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) {
    return undefined
  }

  const normalized = trimmed
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
  const cleaned = trimEdgeHyphens(normalized)
  if (cleaned.length === 0 || cleaned === "default") {
    return undefined
  }
  return cleaned
}
