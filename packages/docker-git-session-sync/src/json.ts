export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const stringField = (value: unknown, key: string): string | null => {
  if (!isRecord(value)) {
    return null
  }
  const field = value[key]
  return typeof field === "string" ? field : null
}

export const numberField = (value: unknown, key: string): number | null => {
  if (!isRecord(value)) {
    return null
  }
  const field = value[key]
  return typeof field === "number" ? field : null
}

export const recordField = (value: unknown, key: string): Readonly<Record<string, unknown>> | null => {
  if (!isRecord(value)) {
    return null
  }
  const field = value[key]
  return isRecord(field) ? field : null
}

export const arrayField = (value: unknown, key: string): ReadonlyArray<unknown> => {
  if (!isRecord(value)) {
    return []
  }
  const field = value[key]
  return Array.isArray(field) ? field : []
}
