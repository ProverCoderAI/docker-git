import { Either } from "effect"

import { buildCreateCommand } from "./cli/parser-create.js"
import { parseRawOptions } from "./cli/parser-options.js"
import { splitPositionalRepo } from "./cli/parser-shared.js"
import type { CreateCommand, ParseError } from "./frontend-lib/core/domain.js"
import { createParseError } from "./menu-create-errors.js"
import type { CreateFlowContext } from "./menu-create-flow-types.js"
import { resolveDefaultOutDir } from "./menu-create-inputs.js"
import type { CreateInputs } from "./menu-types.js"

type CreateTokenizeState = {
  readonly current: string
  readonly escaping: boolean
  readonly quote: "'" | "\"" | null
  readonly tokens: ReadonlyArray<string>
}

const pushCreateToken = (state: CreateTokenizeState): CreateTokenizeState =>
  state.current.length > 0
    ? {
      ...state,
      current: "",
      tokens: [...state.tokens, state.current]
    }
    : state

const consumeCreateTokenChar = (state: CreateTokenizeState, char: string): CreateTokenizeState => {
  if (state.escaping) {
    return {
      ...state,
      current: `${state.current}${char}`,
      escaping: false
    }
  }
  if (char === "\\") {
    return {
      ...state,
      escaping: true
    }
  }
  if (state.quote !== null) {
    if (char === state.quote) {
      return {
        ...state,
        quote: null
      }
    }
    return {
      ...state,
      current: `${state.current}${char}`
    }
  }
  if (char === "'" || char === "\"") {
    return {
      ...state,
      quote: char
    }
  }
  if (/\s/u.test(char)) {
    return pushCreateToken(state)
  }
  return {
    ...state,
    current: `${state.current}${char}`
  }
}

const consumeCreateTokenInput = (
  input: string,
  state: CreateTokenizeState
): CreateTokenizeState => {
  let index = 0
  let next = state
  while (index < input.length) {
    const codePoint = input.codePointAt(index)
    if (codePoint === undefined) {
      return next
    }
    const char = String.fromCodePoint(codePoint)
    next = consumeCreateTokenChar(next, char)
    index += char.length
  }
  return next
}

const tokenizeCreateCommandLine = (
  input: string
): Either.Either<ReadonlyArray<string>, ParseError> => {
  const state = consumeCreateTokenInput(
    input.trim(),
    { current: "", escaping: false, quote: null, tokens: [] }
  )

  if (state.escaping) {
    return Either.left(createParseError("unterminated escape sequence"))
  }
  if (state.quote !== null) {
    return Either.left(createParseError("unterminated quoted value"))
  }

  return Either.right(pushCreateToken(state).tokens)
}

const unsupportedCreatePrefixes = new Set([
  "apply",
  "apply-all",
  "attach",
  "auth",
  "browser",
  "clone",
  "down-all",
  "gists",
  "help",
  "kill-all",
  "mcp-android",
  "mcp-playwright",
  "menu",
  "open",
  "panes",
  "ps",
  "scrap",
  "session-gists",
  "sessions",
  "state",
  "status",
  "stop-all",
  "tmux",
  "ui",
  "update-all",
  "web"
])

const normalizeCreateTokens = (
  tokens: ReadonlyArray<string>
): Either.Either<ReadonlyArray<string>, ParseError> => {
  const withoutBinary = tokens[0] === "docker-git" ? tokens.slice(1) : tokens
  const first = withoutBinary[0]
  if (first === undefined) {
    return Either.right(withoutBinary)
  }
  if (first === "create" || first === "init") {
    return Either.right(withoutBinary.slice(1))
  }
  if (unsupportedCreatePrefixes.has(first)) {
    return Either.left(createParseError(`only create/init options are supported here, got command: ${first}`))
  }
  return Either.right(withoutBinary)
}

type RawCreateOptions = Parameters<typeof buildCreateCommand>[0]

const cpuLimitCreateInput = (raw: RawCreateOptions, command: CreateCommand): Partial<CreateInputs> =>
  raw.cpuLimit === undefined ? {} : { cpuLimit: command.config.cpuLimit ?? "" }

const ramLimitCreateInput = (raw: RawCreateOptions, command: CreateCommand): Partial<CreateInputs> =>
  raw.ramLimit === undefined ? {} : { ramLimit: command.config.ramLimit ?? "" }

const gpuCreateInput = (raw: RawCreateOptions, command: CreateCommand): Partial<CreateInputs> =>
  raw.gpu === undefined ? {} : { gpu: command.config.gpu }

const runUpCreateInput = (raw: RawCreateOptions, command: CreateCommand): Partial<CreateInputs> =>
  raw.up === undefined ? {} : { runUp: command.runUp }

const playwrightCreateInput = (raw: RawCreateOptions, command: CreateCommand): Partial<CreateInputs> =>
  raw.enableMcpPlaywright === undefined ? {} : { enableMcpPlaywright: command.config.enableMcpPlaywright }

const androidCreateInput = (raw: RawCreateOptions, command: CreateCommand): Partial<CreateInputs> =>
  raw.enableMcpAndroid === undefined ? {} : { enableMcpAndroid: command.config.enableMcpAndroid ?? false }

const forceCreateInput = (raw: RawCreateOptions, command: CreateCommand): Partial<CreateInputs> =>
  raw.force === undefined ? {} : { force: command.force }

const forceEnvCreateInput = (raw: RawCreateOptions, command: CreateCommand): Partial<CreateInputs> =>
  raw.forceEnv === undefined ? {} : { forceEnv: command.forceEnv }

const createInputsFromCommand = (
  repoUrl: string,
  raw: RawCreateOptions,
  command: CreateCommand
): Partial<CreateInputs> => ({
  repoUrl,
  repoRef: command.config.repoRef,
  outDir: command.outDir,
  ...cpuLimitCreateInput(raw, command),
  ...ramLimitCreateInput(raw, command),
  ...gpuCreateInput(raw, command),
  ...runUpCreateInput(raw, command),
  ...playwrightCreateInput(raw, command),
  ...androidCreateInput(raw, command),
  ...forceCreateInput(raw, command),
  ...forceEnvCreateInput(raw, command)
})

/**
 * Parses the repo step buffer as either a raw URL or create/init CLI fragment.
 *
 * @pure true
 * @invariant valid(buffer) -> decoded create defaults are deterministic
 * @complexity O(n) where n = |buffer|
 */
// CHANGE: decode the first create-flow prompt through pure CLI-compatible parsing
// WHY: repo URL input may include inline create flags that satisfy later prompts
// QUOTE(ТЗ): "fix CodeRabbit review comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall b in Buffer: parse(b) = Left(error) or Right(partialInputs)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: parser state is immutable across token transitions
// COMPLEXITY: O(n) where n = |buffer|
export const parseRepoStepInput = (
  context: CreateFlowContext,
  buffer: string
): Either.Either<Partial<CreateInputs>, ParseError> => {
  if (buffer.length === 0) {
    return Either.right({
      repoUrl: "",
      outDir: resolveDefaultOutDir(context, "")
    })
  }

  return Either.gen(function*(_) {
    const tokens = yield* _(tokenizeCreateCommandLine(buffer))
    const normalizedTokens = yield* _(normalizeCreateTokens(tokens))
    const { positionalRepoUrl, restArgs } = splitPositionalRepo(normalizedTokens)
    const raw = yield* _(parseRawOptions(restArgs))
    const repoUrl = raw.repoUrl ?? positionalRepoUrl ?? ""
    const command = yield* _(buildCreateCommand({
      ...raw,
      ...((repoUrl.length > 0) && { repoUrl }),
      ...((raw.outDir === undefined) && { outDir: resolveDefaultOutDir(context, repoUrl) })
    }))

    return createInputsFromCommand(repoUrl, raw, command)
  })
}
