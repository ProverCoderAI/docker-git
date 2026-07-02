export const claudeCodeOauthTokenEnvKey = "CLAUDE_CODE_OAUTH_TOKEN"
export const dockerGitClaudeOauthTokenEnvKey = "DOCKER_GIT_CLAUDE_OAUTH_TOKEN"
export const claudeOauthTokenFileName = ".oauth-token"
export const claudeOauthTokenFileMode = 0o600
export const claudeOauthTokenRedactionText = "<redacted-oauth-token>"

export type OAuthEnvironment = Readonly<Record<string, string | undefined>>
export type ClaudeOauthTokenRedactionState = {
  readonly pending: string
  readonly redacting: boolean
}
export type ClaudeOauthTokenRedactionStep = {
  readonly state: ClaudeOauthTokenRedactionState
  readonly output: string
}

export type ClaudeSetupTokenResult =
  | {
    readonly _tag: "ClaudeSetupTokenCaptured"
    readonly token: string
    readonly exitCode: number
    readonly exitedNonZero: boolean
  }
  | {
    readonly _tag: "ClaudeSetupTokenMissing"
    readonly exitCode: 0
  }
  | {
    readonly _tag: "ClaudeSetupTokenCommandFailed"
    readonly exitCode: number
  }

const ansiEscape = "\u{1B}"
const ansiBell = "\u{7}"
const tokenMarker = "Your OAuth token (valid for 1 year):"
const tokenFooterMarker = "Store this token securely."
const oauthTokenRegex = /([A-Za-z0-9][A-Za-z0-9._-]{20,})/u
const oauthLiveOutputTokenPrefix = ["sk", "ant", ""].join("-")
const oauthLiveOutputTokenCharacters = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-".split("")
)

export const initialClaudeOauthTokenRedactionState: ClaudeOauthTokenRedactionState = {
  pending: "",
  redacting: false
}

const isAnsiFinalByte = (codePoint: number | undefined): boolean =>
  codePoint !== undefined && codePoint >= 0x40 && codePoint <= 0x7E

const skipCsiSequence = (raw: string, start: number): number => {
  const length = raw.length
  let index = start + 2
  while (index < length) {
    const codePoint = raw.codePointAt(index)
    if (isAnsiFinalByte(codePoint)) {
      return index + 1
    }
    index += 1
  }
  return index
}

const skipOscSequence = (raw: string, start: number): number => {
  const length = raw.length
  let index = start + 2
  while (index < length) {
    const char = raw[index] ?? ""
    if (char === ansiBell) {
      return index + 1
    }
    if (char === ansiEscape && raw[index + 1] === "\\") {
      return index + 2
    }
    index += 1
  }
  return index
}

const skipEscapeSequence = (raw: string, start: number): number => {
  const next = raw[start + 1] ?? ""
  if (next === "[") {
    return skipCsiSequence(raw, start)
  }
  if (next === "]") {
    return skipOscSequence(raw, start)
  }
  return Math.min(raw.length, start + 2)
}

const stripAnsi = (raw: string): string => {
  const cleaned: Array<string> = []
  let index = 0
  while (index < raw.length) {
    const current = raw[index] ?? ""
    if (current !== ansiEscape) {
      cleaned.push(current)
      index += 1
      continue
    }
    index = skipEscapeSequence(raw, index)
  }
  return cleaned.join("")
}

export const normalizeClaudeOauthToken = (rawToken: string): string | null => {
  const token = rawToken.trim()
  return token.length > 0 ? token : null
}

export const claudeOauthTokenPath = (accountPath: string): string =>
  `${accountPath}/${claudeOauthTokenFileName}`

export const formatClaudeOauthTokenFile = (token: string): string => `${token}\n`

const isOauthLiveOutputTokenCharacter = (char: string): boolean =>
  oauthLiveOutputTokenCharacters.has(char)

const longestOauthTokenPrefixSuffixLength = (text: string): number => {
  const maxLength = Math.min(oauthLiveOutputTokenPrefix.length - 1, text.length)
  let length = maxLength
  while (length > 0) {
    if (oauthLiveOutputTokenPrefix.startsWith(text.slice(-length))) {
      return length
    }
    length -= 1
  }
  return 0
}

const splitOauthRedactionPending = (pending: string): {
  readonly output: string
  readonly pending: string
} => {
  const keepLength = longestOauthTokenPrefixSuffixLength(pending)
  return {
    output: pending.slice(0, pending.length - keepLength),
    pending: pending.slice(pending.length - keepLength)
  }
}

export const redactClaudeOauthTokenChunk = (
  state: ClaudeOauthTokenRedactionState,
  chunk: string
): ClaudeOauthTokenRedactionStep => {
  let pending = state.pending
  let redacting = state.redacting
  const output: Array<string> = []

  const acceptPlainChar = (char: string): void => {
    pending = `${pending}${char}`
    if (pending === oauthLiveOutputTokenPrefix) {
      pending = ""
      redacting = true
      return
    }
    if (oauthLiveOutputTokenPrefix.startsWith(pending)) {
      return
    }
    const split = splitOauthRedactionPending(pending)
    output.push(split.output)
    pending = split.pending
  }

  for (const char of chunk) {
    if (redacting) {
      if (isOauthLiveOutputTokenCharacter(char)) {
        continue
      }
      output.push(claudeOauthTokenRedactionText)
      redacting = false
      acceptPlainChar(char)
      continue
    }
    acceptPlainChar(char)
  }

  return {
    state: { pending, redacting },
    output: output.join("")
  }
}

export const flushClaudeOauthTokenRedactionState = (
  state: ClaudeOauthTokenRedactionState
): string => state.redacting ? claudeOauthTokenRedactionText : state.pending

export const redactClaudeOauthTokenText = (text: string): string => {
  const step = redactClaudeOauthTokenChunk(initialClaudeOauthTokenRedactionState, text)
  return `${step.output}${flushClaudeOauthTokenRedactionState(step.state)}`
}

export const extractClaudeOauthToken = (rawOutput: string): string | null => {
  const normalized = stripAnsi(rawOutput).replaceAll("\r", "\n")
  const markerIndex = normalized.lastIndexOf(tokenMarker)
  if (markerIndex === -1) {
    return null
  }

  const tail = normalized.slice(markerIndex + tokenMarker.length)
  const footerIndex = tail.indexOf(tokenFooterMarker)
  const tokenSection = footerIndex === -1 ? tail : tail.slice(0, footerIndex)
  const compactSection = tokenSection.replaceAll(/\s+/gu, "")
  const compactMatch = oauthTokenRegex.exec(compactSection)
  if (compactMatch?.[1] !== undefined) {
    return compactMatch[1]
  }

  const directMatch = oauthTokenRegex.exec(tokenSection)
  return directMatch?.[1] ?? null
}

export const readClaudeOauthTokenFromEnv = (
  env: OAuthEnvironment,
  keys: ReadonlyArray<string>
): string | null => {
  for (const key of keys) {
    const value = env[key]
    if (value === undefined) {
      continue
    }
    const token = normalizeClaudeOauthToken(value)
    if (token !== null) {
      return token
    }
  }
  return null
}

export const classifyClaudeSetupTokenResult = (
  rawToken: string | null,
  exitCode: number
): ClaudeSetupTokenResult => {
  const token = rawToken === null ? null : normalizeClaudeOauthToken(rawToken)
  if (token !== null) {
    return {
      _tag: "ClaudeSetupTokenCaptured",
      token,
      exitCode,
      exitedNonZero: exitCode !== 0
    }
  }
  if (exitCode !== 0) {
    return { _tag: "ClaudeSetupTokenCommandFailed", exitCode }
  }
  return { _tag: "ClaudeSetupTokenMissing", exitCode }
}
