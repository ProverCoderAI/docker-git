type EnvEntry = {
  readonly key: string
  readonly value: string
}

const parseEnvEntries = (input: string): ReadonlyArray<EnvEntry> => {
  const entries: Array<EnvEntry> = []
  for (const rawLine of input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith("#")) {
      continue
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line
    const equalsIndex = normalized.indexOf("=")
    if (equalsIndex <= 0) {
      continue
    }
    const key = normalized.slice(0, equalsIndex).trim()
    const value = normalized.slice(equalsIndex + 1).trim()
    if (key.length === 0) {
      continue
    }
    entries.push({ key, value })
  }
  return entries
}

export const normalizeLabel = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ""
  }
  const normalized = trimmed
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")

  let start = 0
  while (start < normalized.length && normalized[start] === "_") {
    start += 1
  }
  let end = normalized.length
  while (end > start && normalized[end - 1] === "_") {
    end -= 1
  }
  const cleaned = normalized.slice(start, end)
  return cleaned.length > 0 ? cleaned : ""
}

export const buildLabeledEnvKey = (baseKey: string, label: string): string => {
  const normalized = normalizeLabel(label)
  if (normalized.length === 0 || normalized === "DEFAULT") {
    return baseKey
  }
  return `${baseKey}__${normalized}`
}

export const countKeyEntries = (envText: string, baseKey: string): number => {
  const prefix = `${baseKey}__`
  return parseEnvEntries(envText)
    .filter((entry) => entry.value.trim().length > 0 && (entry.key === baseKey || entry.key.startsWith(prefix)))
    .length
}
