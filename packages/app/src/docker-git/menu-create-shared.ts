import { Either, Match } from "effect"
import {
  type CreateCommand,
  defaultTemplateConfig,
  deriveRepoPathParts,
  type GpuMode,
  isGpuMode,
  type ParseError,
  resolveRepoInput
} from "./frontend-lib/core/domain.js"
import { defaultProjectsRoot } from "./frontend-lib/usecases/menu-helpers.js"

import { buildCreateCommand } from "./cli/parser-create.js"
import { parseRawOptions } from "./cli/parser-options.js"
import { splitPositionalRepo } from "./cli/parser-shared.js"
import { type CreateInputs, type CreateStep, createSteps } from "./menu-types.js"

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export type CreateFlowContext = {
  readonly cwd: string
  readonly projectsRoot?: string | undefined
}

export type CreateFlowView = {
  readonly step: number
  readonly buffer: string
  readonly values: Partial<CreateInputs>
}

type AdvanceCreateFlowResult =
  | { readonly _tag: "Continue"; readonly view: CreateFlowView }
  | { readonly _tag: "Error"; readonly error: ParseError }
  | { readonly _tag: "Complete"; readonly inputs: CreateInputs }

type AdvanceCreateFlowHandlers = {
  readonly onComplete: (inputs: CreateInputs) => void
  readonly onContinue: (view: CreateFlowView) => void
  readonly onError: (error: ParseError) => void
}

type AdvanceCreateFlowOptions = {
  readonly quickCreate?: boolean
}

const trimLeftSlash = (value: string): string => {
  let start = 0
  while (start < value.length && value[start] === "/") {
    start += 1
  }
  return value.slice(start)
}

const trimRightSlash = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") {
    end -= 1
  }
  return value.slice(0, end)
}

const joinPath = (...parts: ReadonlyArray<string>): string => {
  const cleaned = parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) {
        return trimRightSlash(part)
      }
      return trimRightSlash(trimLeftSlash(part))
    })
  return cleaned.join("/")
}

export const renderCreateStepLabel = (step: CreateStep, defaults: CreateInputs): string =>
  Match.value(step).pipe(
    Match.when("repoUrl", () => "Repo URL (optional for empty workspace)"),
    Match.when("repoRef", () => `Repo ref [${defaults.repoRef}]`),
    Match.when("outDir", () => `Output dir [${defaults.outDir}]`),
    Match.when("cpuLimit", () => `CPU limit [${defaults.cpuLimit || "30%"}]`),
    Match.when("ramLimit", () => `RAM limit [${defaults.ramLimit || "30%"}]`),
    Match.when("gpu", () => `GPU access [${defaults.gpu}]`),
    Match.when("runUp", () => `Run docker compose up now? [${defaults.runUp ? "Y" : "n"}]`),
    Match.when(
      "mcpPlaywright",
      () => `Enable Playwright MCP (nested Chromium browser)? [${defaults.enableMcpPlaywright ? "y" : "N"}]`
    ),
    Match.when(
      "force",
      () => `Force recreate (overwrite files + wipe volumes)? [${defaults.force ? "y" : "N"}]`
    ),
    Match.exhaustive
  )

const normalizeCreateFlowContext = (
  context: string | CreateFlowContext
): CreateFlowContext =>
  typeof context === "string"
    ? { cwd: context }
    : context

const resolveProjectsRoot = (context: CreateFlowContext): string =>
  context.projectsRoot?.trim().length
    ? context.projectsRoot
    : defaultProjectsRoot(context.cwd)

const resolveDefaultOutDir = (context: CreateFlowContext, repoUrl: string): string => {
  const resolvedRepo = resolveRepoInput(repoUrl)
  const baseParts = deriveRepoPathParts(resolvedRepo.repoUrl).pathParts
  const projectParts = resolvedRepo.workspaceSuffix ? [...baseParts, resolvedRepo.workspaceSuffix] : baseParts
  return joinPath(resolveProjectsRoot(context), ...projectParts)
}

export const resolveCreateInputs = (
  contextOrCwd: string | CreateFlowContext,
  values: Partial<CreateInputs>
): CreateInputs => {
  const context = normalizeCreateFlowContext(contextOrCwd)
  const repoUrl = values.repoUrl ?? ""
  const resolvedRepoRef = resolveRepoInput(repoUrl).repoRef
  const outDir = values.outDir ?? resolveDefaultOutDir(context, repoUrl)

  return {
    repoUrl,
    repoRef: values.repoRef ?? resolvedRepoRef ?? "main",
    outDir,
    cpuLimit: values.cpuLimit ?? "",
    ramLimit: values.ramLimit ?? "",
    gpu: values.gpu ?? defaultTemplateConfig.gpu,
    runUp: values.runUp !== false,
    enableMcpPlaywright: values.enableMcpPlaywright === true,
    force: values.force === true,
    forceEnv: values.forceEnv === true
  }
}

const parseGpuInput = (
  input: string,
  fallback: GpuMode
): Either.Either<GpuMode, ParseError> => {
  const normalized = input.trim().toLowerCase()
  if (normalized.length === 0) {
    return Either.right(fallback)
  }
  if (normalized === "y" || normalized === "yes") {
    return Either.right("all")
  }
  if (normalized === "n" || normalized === "no") {
    return Either.right("none")
  }
  if (isGpuMode(normalized)) {
    return Either.right(normalized)
  }
  return Either.left(createParseError("gpu must be one of: none, all, yes, no"))
}

const parseYesDefault = (input: string, fallback: boolean): boolean => {
  const normalized = input.trim().toLowerCase()
  if (normalized === "y" || normalized === "yes") {
    return true
  }
  if (normalized === "n" || normalized === "no") {
    return false
  }
  return fallback
}

const createParseError = (reason: string): ParseError => ({
  _tag: "InvalidOption",
  option: "create",
  reason
})

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

const parseRepoStepInput = (
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

const createStepApplied = (): Either.Either<true, ParseError> => {
  const applied = true
  return Either.right(applied)
}

const hasOwn = (values: Partial<CreateInputs>, key: keyof CreateInputs): boolean =>
  Object.prototype.hasOwnProperty.call(values, key)

const isCreateStepSatisfied = (
  step: CreateStep,
  values: Partial<CreateInputs>
): boolean =>
  Match.value(step).pipe(
    Match.when("repoUrl", () => true),
    Match.when("repoRef", () => true),
    Match.when("outDir", () => true),
    Match.when("cpuLimit", () => hasOwn(values, "cpuLimit")),
    Match.when("ramLimit", () => hasOwn(values, "ramLimit")),
    Match.when("gpu", () => hasOwn(values, "gpu")),
    Match.when("runUp", () => hasOwn(values, "runUp")),
    Match.when("mcpPlaywright", () => hasOwn(values, "enableMcpPlaywright")),
    Match.when("force", () => hasOwn(values, "force")),
    Match.exhaustive
  )

export const resolveCreateFlowSteps = (
  values: Partial<CreateInputs>
): ReadonlyArray<CreateStep> => [
  "repoUrl",
  ...createSteps
    .filter((step) => step !== "repoUrl")
    .filter((step) => !isCreateStepSatisfied(step, values))
]

const applyCreateStep = (input: {
  readonly step: CreateStep
  readonly buffer: string
  readonly currentDefaults: CreateInputs
  readonly nextValues: Partial<Mutable<CreateInputs>>
  readonly context: CreateFlowContext
}): Either.Either<true, ParseError> =>
  Match.value(input.step).pipe(
    Match.when("repoUrl", () => {
      const parsed = parseRepoStepInput(input.context, input.buffer)
      if (Either.isLeft(parsed)) {
        return Either.left(parsed.left)
      }
      Object.assign(input.nextValues, parsed.right)
      return createStepApplied()
    }),
    Match.when("repoRef", () => {
      input.nextValues.repoRef = input.buffer.length > 0 ? input.buffer : input.currentDefaults.repoRef
      return createStepApplied()
    }),
    Match.when("outDir", () => {
      input.nextValues.outDir = input.buffer.length > 0 ? input.buffer : input.currentDefaults.outDir
      return createStepApplied()
    }),
    Match.when("cpuLimit", () => {
      input.nextValues.cpuLimit = input.buffer.length > 0 ? input.buffer : input.currentDefaults.cpuLimit
      return createStepApplied()
    }),
    Match.when("ramLimit", () => {
      input.nextValues.ramLimit = input.buffer.length > 0 ? input.buffer : input.currentDefaults.ramLimit
      return createStepApplied()
    }),
    Match.when("gpu", () => {
      const gpu = parseGpuInput(input.buffer, input.currentDefaults.gpu)
      if (Either.isLeft(gpu)) {
        return Either.left(gpu.left)
      }
      input.nextValues.gpu = gpu.right
      return createStepApplied()
    }),
    Match.when("runUp", () => {
      input.nextValues.runUp = parseYesDefault(input.buffer, input.currentDefaults.runUp)
      return createStepApplied()
    }),
    Match.when("mcpPlaywright", () => {
      input.nextValues.enableMcpPlaywright = parseYesDefault(
        input.buffer,
        input.currentDefaults.enableMcpPlaywright
      )
      return createStepApplied()
    }),
    Match.when("force", () => {
      input.nextValues.force = parseYesDefault(input.buffer, input.currentDefaults.force)
      return createStepApplied()
    }),
    Match.exhaustive
  )

export const createInitialFlowView = (buffer = ""): CreateFlowView => ({
  step: 0,
  buffer,
  values: {}
})

const shouldQuickCreate = (
  step: CreateStep,
  options: AdvanceCreateFlowOptions
): boolean =>
  step === "repoUrl" &&
  options.quickCreate === true

const continueCreateFlow = (
  nextStep: number,
  nextValues: Partial<Mutable<CreateInputs>>
): AdvanceCreateFlowResult => ({
  _tag: "Continue",
  view: {
    step: nextStep,
    buffer: "",
    values: nextValues
  }
})

export const advanceCreateFlow = (
  contextOrCwd: string | CreateFlowContext,
  view: CreateFlowView,
  options: AdvanceCreateFlowOptions = {}
): AdvanceCreateFlowResult | null => {
  const context = normalizeCreateFlowContext(contextOrCwd)
  const currentSteps = resolveCreateFlowSteps(view.values)
  const step = currentSteps[view.step]
  if (step === undefined) {
    return null
  }

  const buffer = view.buffer.trim()
  const currentDefaults = resolveCreateInputs(context, view.values)
  const nextValues: Partial<Mutable<CreateInputs>> = { ...view.values }
  const updated = applyCreateStep({
    step,
    buffer,
    currentDefaults,
    nextValues,
    context
  })
  if (Either.isLeft(updated)) {
    return {
      _tag: "Error",
      error: updated.left
    }
  }

  if (shouldQuickCreate(step, options)) {
    return {
      _tag: "Complete",
      inputs: resolveCreateInputs(context, nextValues)
    }
  }

  const nextSteps = resolveCreateFlowSteps(nextValues)
  const nextStep = step === "repoUrl" ? 1 : view.step
  if (nextStep < nextSteps.length) {
    return continueCreateFlow(nextStep, nextValues)
  }

  return {
    _tag: "Complete",
    inputs: resolveCreateInputs(context, nextValues)
  }
}

export const handleAdvanceCreateFlowResult = (
  next: AdvanceCreateFlowResult | null,
  handlers: AdvanceCreateFlowHandlers
): void => {
  if (next === null) {
    return
  }
  if (next._tag === "Error") {
    handlers.onError(next.error)
    return
  }
  if (next._tag === "Continue") {
    handlers.onContinue(next.view)
    return
  }
  handlers.onComplete(next.inputs)
}

export const createProjectDraftFromInputs = (
  input: CreateInputs
): {
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly cpuLimit: string
  readonly ramLimit: string
  readonly gpu: GpuMode
  readonly up: boolean
  readonly enableMcpPlaywright: boolean
  readonly force: boolean
  readonly forceEnv: boolean
} => ({
  repoUrl: input.repoUrl,
  repoRef: input.repoRef,
  outDir: input.outDir,
  cpuLimit: input.cpuLimit,
  ramLimit: input.ramLimit,
  gpu: input.gpu,
  up: input.runUp,
  enableMcpPlaywright: input.enableMcpPlaywright,
  force: input.force,
  forceEnv: input.forceEnv
})
