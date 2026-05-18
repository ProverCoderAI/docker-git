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
  readonly inputError: string | null
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

/**
 * Direction over the finite ordered set of unresolved Create settings rows.
 *
 * @pure true
 * @effect none
 * @invariant value ∈ {"up", "down"}
 * @precondition n/a
 * @postcondition navigation direction is total for settings rows
 * @complexity O(1)
 */
export type CreateSettingsNavigationDirection = "up" | "down"

/**
 * Horizontal choice direction over finite Create settings with discrete values.
 *
 * @pure true
 * @effect none
 * @invariant value ∈ {"left", "right"}
 * @precondition n/a
 * @postcondition direction maps only to an input-buffer token, never to applied Create values
 * @complexity O(1)
 */
export type CreateSettingsChoiceDirection = "left" | "right"

/**
 * User-facing key guide shown only after Create leaves the repo URL step.
 *
 * @pure true
 * @effect none
 * @invariant hint contains the complete settings-mode key contract
 * @precondition CreateFlowView.step > 0
 * @postcondition no repo-step quick-create guidance is rendered from this value
 * @complexity O(1)
 */
export const createSettingsHint = "↑ - up, ↓ - down, Enter - apply"

const firstCreateSettingsStepIndex = 1

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

const renderExplicitBooleanChoice = (value: boolean): string => value ? "Y" : "N"

const parseBooleanChoice = (input: string): boolean | null => {
  const normalized = input.trim().toLowerCase()
  if (normalized === "y" || normalized === "yes") {
    return true
  }
  if (normalized === "n" || normalized === "no") {
    return false
  }
  return null
}

const parseExplicitBooleanChoice = parseBooleanChoice

const parseExplicitGpuChoice = (
  input: string
): GpuMode | null => {
  const normalized = input.trim().toLowerCase()
  if (normalized === "y" || normalized === "yes") {
    return "all"
  }
  if (normalized === "n" || normalized === "no") {
    return "none"
  }
  if (isGpuMode(normalized)) {
    return normalized
  }
  return null
}

/**
 * Renders the active Create settings label with an unapplied input-buffer preview.
 *
 * @pure true
 * @effect none
 * @invariant invalid or empty preview buffers preserve the committed/default label
 * @precondition defaults are resolved Create inputs
 * @postcondition Create values are not mutated or applied by rendering
 * @complexity O(1)
 */
export const renderCreateStepLabelWithBufferPreview = (
  step: CreateStep,
  defaults: CreateInputs,
  buffer: string
): string =>
  Match.value(step).pipe(
    Match.when("repoUrl", () => renderCreateStepLabel(step, defaults)),
    Match.when("repoRef", () => renderCreateStepLabel(step, defaults)),
    Match.when("outDir", () => renderCreateStepLabel(step, defaults)),
    Match.when("cpuLimit", () => renderCreateStepLabel(step, defaults)),
    Match.when("ramLimit", () => renderCreateStepLabel(step, defaults)),
    Match.when("gpu", () => {
      const gpu = parseExplicitGpuChoice(buffer)
      return gpu === null ? renderCreateStepLabel(step, defaults) : `GPU access [${gpu}]`
    }),
    Match.when("runUp", () => {
      const runUp = parseExplicitBooleanChoice(buffer)
      return runUp === null
        ? renderCreateStepLabel(step, defaults)
        : `Run docker compose up now? [${renderExplicitBooleanChoice(runUp)}]`
    }),
    Match.when("mcpPlaywright", () => {
      const enableMcpPlaywright = parseExplicitBooleanChoice(buffer)
      return enableMcpPlaywright === null
        ? renderCreateStepLabel(step, defaults)
        : `Enable Playwright MCP (nested Chromium browser)? [${renderExplicitBooleanChoice(enableMcpPlaywright)}]`
    }),
    Match.when("force", () => {
      const force = parseExplicitBooleanChoice(buffer)
      return force === null
        ? renderCreateStepLabel(step, defaults)
        : `Force recreate (overwrite files + wipe volumes)? [${renderExplicitBooleanChoice(force)}]`
    }),
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

const parseYesDefault = (input: string, fallback: boolean): boolean => parseBooleanChoice(input) ?? fallback

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

/**
 * Resolves the stable Create display rows used by browser Settings mode.
 *
 * @pure true
 * @effect none
 * @invariant result = createSteps and is independent of applied values
 * @precondition n/a
 * @postcondition applied settings rows remain present in the result
 * @complexity O(1)
 */
export const resolveCreateDisplaySteps = (
  _values: Partial<CreateInputs> = {}
): ReadonlyArray<CreateStep> => createSteps

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

const applyCreateBufferToValues = (
  context: CreateFlowContext,
  view: CreateFlowView,
  step: CreateStep
): Either.Either<Partial<Mutable<CreateInputs>>, ParseError> => {
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
  return Either.isLeft(updated) ? Either.left(updated.left) : Either.right(nextValues)
}

export const createInitialFlowView = (buffer = ""): CreateFlowView => ({
  step: 0,
  buffer,
  inputError: null,
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
    inputError: null,
    values: nextValues
  }
})

const clampCreateSettingsStep = (
  step: number,
  lastStep: number
): number => Math.min(Math.max(step, firstCreateSettingsStepIndex), lastStep)

const nextCreateSettingsStep = (
  step: number,
  lastStep: number,
  direction: CreateSettingsNavigationDirection
): number =>
  Match.value(direction).pipe(
    Match.when("up", () => step === firstCreateSettingsStepIndex ? lastStep : step - 1),
    Match.when("down", () => step === lastStep ? firstCreateSettingsStepIndex : step + 1),
    Match.exhaustive
  )

const moveCreateSettingsWithin = (
  view: CreateFlowView,
  lastStep: number,
  direction: CreateSettingsNavigationDirection
): CreateFlowView | null => {
  if (view.step < firstCreateSettingsStepIndex || lastStep < firstCreateSettingsStepIndex) {
    return null
  }

  const currentStep = clampCreateSettingsStep(view.step, lastStep)
  const step = nextCreateSettingsStep(currentStep, lastStep, direction)
  return step === view.step
    ? view
    : {
      ...view,
      step,
      buffer: "",
      inputError: null
    }
}

const booleanChoiceBuffer = (direction: CreateSettingsChoiceDirection): string =>
  Match.value(direction).pipe(
    Match.when("left", () => "n"),
    Match.when("right", () => "y"),
    Match.exhaustive
  )

const gpuChoiceBuffer = (direction: CreateSettingsChoiceDirection): string =>
  Match.value(direction).pipe(
    Match.when("left", () => "none"),
    Match.when("right", () => "all"),
    Match.exhaustive
  )

/**
 * Resolves a horizontal settings choice to the Create input buffer without applying it.
 *
 * @pure true
 * @effect none
 * @invariant result = null for free-text Create rows
 * @invariant result != null -> view.values are unchanged by caller-visible semantics
 * @precondition view is a CreateFlowView snapshot
 * @postcondition result ∈ {"none", "all", "n", "y"} ∪ {null}
 * @complexity O(1)
 */
export const resolveCreateSettingsChoiceBuffer = (
  view: CreateFlowView,
  direction: CreateSettingsChoiceDirection
): string | null => {
  const step = resolveCreateDisplaySteps()[view.step]
  if (step === undefined) {
    return null
  }

  return Match.value(step).pipe(
    Match.when("repoUrl", () => null),
    Match.when("repoRef", () => null),
    Match.when("outDir", () => null),
    Match.when("cpuLimit", () => null),
    Match.when("ramLimit", () => null),
    Match.when("gpu", () => gpuChoiceBuffer(direction)),
    Match.when("runUp", () => booleanChoiceBuffer(direction)),
    Match.when("mcpPlaywright", () => booleanChoiceBuffer(direction)),
    Match.when("force", () => booleanChoiceBuffer(direction)),
    Match.exhaustive
  )
}

/**
 * Moves the selected Create settings row without applying the current buffer.
 *
 * @pure true
 * @effect none
 * @invariant view.step = 0 -> result = null
 * @invariant result != null -> 1 <= result.step < |resolveCreateFlowSteps(result.values)|
 * @invariant result != null && result.step != view.step -> result.buffer = ""
 * @precondition view is a CreateFlowView snapshot
 * @postcondition result values are identical to the input values
 * @complexity O(n) where n is the number of unresolved Create steps
 */
export const moveCreateSettingsStep = (
  view: CreateFlowView,
  direction: CreateSettingsNavigationDirection
): CreateFlowView | null => moveCreateSettingsWithin(view, resolveCreateFlowSteps(view.values).length - 1, direction)

/**
 * Moves the selected browser Create settings row over the full display list.
 *
 * @pure true
 * @effect none
 * @invariant applied rows do not affect navigation order
 * @invariant view.step = 0 -> result = null
 * @invariant result != null -> 1 <= result.step < |resolveCreateDisplaySteps()|
 * @precondition view is a CreateFlowView snapshot
 * @postcondition result values are identical to input values
 * @complexity O(1)
 */
export const moveCreateDisplaySettingsStep = (
  view: CreateFlowView,
  direction: CreateSettingsNavigationDirection
): CreateFlowView | null => moveCreateSettingsWithin(view, resolveCreateDisplaySteps().length - 1, direction)

const resolveActiveCreateDisplayStep = (view: CreateFlowView): CreateStep | null => {
  const step = resolveCreateDisplaySteps()[view.step]
  return view.step < firstCreateSettingsStepIndex || step === undefined ? null : step
}

type ActiveCreateDisplayContext = {
  readonly context: CreateFlowContext
  readonly step: CreateStep
}

const resolveActiveCreateDisplayContext = (
  contextOrCwd: string | CreateFlowContext,
  view: CreateFlowView
): ActiveCreateDisplayContext | null => {
  const step = resolveActiveCreateDisplayStep(view)
  return step === null
    ? null
    : {
      context: normalizeCreateFlowContext(contextOrCwd),
      step
    }
}

const completeCreateFlow = (
  context: CreateFlowContext,
  values: Partial<CreateInputs>
): AdvanceCreateFlowResult => ({
  _tag: "Complete",
  inputs: resolveCreateInputs(context, values)
})

const foldAppliedCreateValues = (
  appliedValues: Either.Either<Partial<Mutable<CreateInputs>>, ParseError>,
  onSuccess: (nextValues: Partial<Mutable<CreateInputs>>) => AdvanceCreateFlowResult
): AdvanceCreateFlowResult =>
  Either.isLeft(appliedValues)
    ? {
      _tag: "Error",
      error: appliedValues.left
    }
    : onSuccess(appliedValues.right)

const withActiveCreateDisplayContext = (
  contextOrCwd: string | CreateFlowContext,
  view: CreateFlowView,
  onActive: (active: ActiveCreateDisplayContext) => AdvanceCreateFlowResult | null
): AdvanceCreateFlowResult | null => {
  const active = resolveActiveCreateDisplayContext(contextOrCwd, view)
  return active === null ? null : onActive(active)
}

/**
 * Applies one browser Create settings display row without advancing or submitting.
 *
 * @pure true
 * @effect none
 * @invariant result._tag = "Continue" -> result.view.step = view.step
 * @invariant result._tag = "Continue" -> result.view.buffer = ""
 * @precondition view.step points at a settings display row
 * @postcondition successful result stores the parsed setting in result.view.values
 * @complexity O(1)
 */
export const applyCreateDisplaySettingsStep = (
  contextOrCwd: string | CreateFlowContext,
  view: CreateFlowView
): AdvanceCreateFlowResult | null =>
  withActiveCreateDisplayContext(contextOrCwd, view, (active) =>
    foldAppliedCreateValues(
      applyCreateBufferToValues(active.context, view, active.step),
      (nextValues) => continueCreateFlow(view.step, nextValues)
    ))

/**
 * Completes browser Create settings by applying a non-empty active buffer first.
 *
 * @pure true
 * @effect none
 * @invariant non-empty invalid buffer -> result._tag = "Error"
 * @invariant successful result._tag = "Complete"
 * @precondition view.step points at a settings display row
 * @postcondition submitted inputs include all committed values and defaults
 * @complexity O(1)
 */
export const completeCreateDisplaySettingsFlow = (
  contextOrCwd: string | CreateFlowContext,
  view: CreateFlowView
): AdvanceCreateFlowResult | null =>
  withActiveCreateDisplayContext(contextOrCwd, view, (active) => {
    if (view.buffer.trim().length === 0) {
      return completeCreateFlow(active.context, view.values)
    }

    const applied = applyCreateDisplaySettingsStep(active.context, view)
    if (applied === null || applied._tag === "Error") {
      return applied
    }
    if (applied._tag === "Continue") {
      return completeCreateFlow(active.context, applied.view.values)
    }
    return applied
  })

const resolveNextCreateFlowStep = (
  currentStep: CreateStep,
  currentStepIndex: number,
  nextSteps: ReadonlyArray<CreateStep>
): number =>
  currentStep === "repoUrl"
    ? firstCreateSettingsStepIndex
    : clampCreateSettingsStep(currentStepIndex, nextSteps.length - 1)

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

  return foldAppliedCreateValues(
    applyCreateBufferToValues(context, view, step),
    (nextValues) => {
      if (shouldQuickCreate(step, options)) {
        return completeCreateFlow(context, nextValues)
      }

      const nextSteps = resolveCreateFlowSteps(nextValues)
      const nextStep = resolveNextCreateFlowStep(step, view.step, nextSteps)
      return nextSteps.length > firstCreateSettingsStepIndex && nextStep < nextSteps.length
        ? continueCreateFlow(nextStep, nextValues)
        : completeCreateFlow(context, nextValues)
    }
  )
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
