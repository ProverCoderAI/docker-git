export type TerminalImageGalleryEntry = {
  readonly fetchUrl: string
  readonly path: string
}

export const terminalImageGalleryLimit = 20

export const appendTerminalImageGalleryEntries = (
  current: ReadonlyArray<TerminalImageGalleryEntry>,
  incoming: ReadonlyArray<TerminalImageGalleryEntry>,
  limit: number = terminalImageGalleryLimit
): ReadonlyArray<TerminalImageGalleryEntry> => {
  if (incoming.length === 0) {
    return current
  }
  const known = new Set(current.map((entry) => entry.path))
  const additions: Array<TerminalImageGalleryEntry> = []
  for (const entry of incoming) {
    if (known.has(entry.path)) {
      continue
    }
    known.add(entry.path)
    additions.push(entry)
  }
  if (additions.length === 0) {
    return current
  }
  const combined = [...current, ...additions]
  if (combined.length <= limit) {
    return combined
  }
  return combined.slice(combined.length - limit)
}
