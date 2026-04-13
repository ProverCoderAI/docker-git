export const trimToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : undefined
}
