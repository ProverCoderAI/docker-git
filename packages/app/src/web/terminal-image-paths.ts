const supportedExtensions: ReadonlyArray<string> = ["png", "jpg", "jpeg", "gif", "webp"]

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

export type TerminalImagePathMatch = {
  readonly endIndex: number
  readonly path: string
  readonly startIndex: number
}

export const stripTerminalAnsi = (text: string): string =>
  text.replace(ansiOscPattern, "").replace(ansiCsiPattern, "").replace(ansiOtherEscapePattern, "")

export const detectTerminalImagePathMatches = (text: string): ReadonlyArray<TerminalImagePathMatch> => {
  const plainText = stripTerminalAnsi(text)
  const matches: Array<TerminalImagePathMatch> = []
  for (const match of plainText.matchAll(imagePathPattern)) {
    const candidate = match[1]
    if (candidate !== undefined && candidate.length > 0) {
      const fullMatch = match[0]
      const fullStartIndex = match.index
      const startIndex = fullStartIndex + fullMatch.lastIndexOf(candidate)
      matches.push({
        endIndex: startIndex + candidate.length,
        path: candidate,
        startIndex
      })
    }
  }
  return matches
}

export const detectTerminalImagePaths = (text: string): ReadonlyArray<string> => {
  const matches = new Set<string>()
  for (const match of detectTerminalImagePathMatches(text)) {
    matches.add(match.path)
  }
  return [...matches]
}

export const isSupportedTerminalImagePath = (path: string): boolean => {
  const lower = path.toLowerCase()
  return supportedExtensions.some((extension) => lower.endsWith(`.${extension}`))
}
