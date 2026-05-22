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
  current: string
  escaping: boolean
  quote: "'" | "\"" | null
  readonly tokens: Array<string>
}

const pushCreateToken = (state: CreateTokenizeState): void => {
  if (state.current.length > 0) {
    state.tokens.push(state.current)
    state.current = ""
  }
}

const consumeCreateTokenChar = (state: CreateTokenizeState, char: string): void => {
  if (state.escaping) {
    state.current += char
    state.escaping = false
    return
  }
  if (char === "\\") {
    state.escaping = true
    return
  }
  if (state.quote !== null) {
    if (char === state.quote) {
      state.quote = null
      return
    }
    state.current += char
    return
  }
  if (char === "'" || char === "\"") {
    state.quote = char
    return
  }
  if (/\s/u.test(char)) {
    pushCreateToken(state)
    return
  }
  state.current += char
}

const tokenizeCreateCommandLine = (
  input: string
): Either.Either<ReadonlyArray<string>, ParseError> => {
  const state: CreateTokenizeState = { current: "", escaping: false, quote: null, tokens: [] }

  for (const char of input.trim()) {
    consumeCreateTokenChar(state, char)
  }

  if (state.escaping) {
    return Either.left(createParseError("unterminated escape sequence"))
  }
  if (state.quote !== null) {
    return Either.left(createParseError("unterminated quoted value"))
  }

  pushCreateToken(state)
  return Either.right(state.tokens)
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
  ...forceCreateInput(raw, command),
  ...forceEnvCreateInput(raw, command)
})

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
      ...(repoUrl.length > 0 ? { repoUrl } : {}),
      ...(raw.outDir === undefined ? { outDir: resolveDefaultOutDir(context, repoUrl) } : {})
    }))

    return createInputsFromCommand(repoUrl, raw, command)
  })
}
