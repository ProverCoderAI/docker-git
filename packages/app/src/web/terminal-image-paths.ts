const supportedExtensions = ["png", "jpg", "jpeg", "gif", "webp"] as const

const extensionAlternation = supportedExtensions.join("|")

const imagePathPattern = new RegExp(
  String.raw`(?:^|[\s"'(<>\[\]{}|])(/[^\s"'(<>\[\]{}|\\]+\.(?:${extensionAlternation}))(?=$|[\s"')<>\[\]{}|.,;:?!])`,
  "giu"
)

const escapeChar = String.fromCodePoint(0x1B)
const bellChar = String.fromCodePoint(0x07)

const buildAnsiPattern = (source: string): RegExp => new RegExp(source, "gu")

const ansiCsiPattern = buildAnsiPattern(String.raw`${escapeChar}\[[0-?]*[ -/]*[@-~]`)
const ansiOscPattern = buildAnsiPattern(String.raw`${escapeChar}\][\s\S]*?(?:${bellChar}|${escapeChar}\\)`)
const ansiOtherEscapePattern = buildAnsiPattern(`${escapeChar}.`)

export const stripTerminalAnsi = (text: string): string =>
  text.replace(ansiOscPattern, "").replace(ansiCsiPattern, "").replace(ansiOtherEscapePattern, "")

export const detectTerminalImagePaths = (text: string): ReadonlyArray<string> => {
  const matches = new Set<string>()
  for (const match of stripTerminalAnsi(text).matchAll(imagePathPattern)) {
    const candidate = match[1]
    if (candidate !== undefined && candidate.length > 0) {
      matches.add(candidate)
    }
  }
  return [...matches]
}

export const isSupportedTerminalImagePath = (path: string): boolean => {
  const lower = path.toLowerCase()
  return supportedExtensions.some((extension) => lower.endsWith(`.${extension}`))
}
