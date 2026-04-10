export const normalizeOptionalText = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length === 0 ? null : trimmed
}
