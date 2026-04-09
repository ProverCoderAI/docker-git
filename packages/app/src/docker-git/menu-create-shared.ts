import { deriveRepoPathParts, resolveRepoInput } from "@lib/core/domain"
import { defaultProjectsRoot, isRepoUrlInput } from "@lib/usecases/menu-helpers"
import { Match } from "effect"

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
  | { readonly _tag: "Complete"; readonly inputs: CreateInputs }

type AdvanceCreateFlowOptions = {
  readonly forceWizard?: boolean
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
    Match.when("runUp", () => `Run docker compose up now? [${defaults.runUp ? "Y" : "n"}]`),
    Match.when(
      "mcpPlaywright",
      () => `Enable Playwright MCP (Chromium sidecar)? [${defaults.enableMcpPlaywright ? "y" : "N"}]`
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
    runUp: values.runUp !== false,
    enableMcpPlaywright: values.enableMcpPlaywright === true,
    force: values.force === true,
    forceEnv: values.forceEnv === true
  }
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

const applyCreateStep = (input: {
  readonly step: CreateStep
  readonly buffer: string
  readonly currentDefaults: CreateInputs
  readonly nextValues: Partial<Mutable<CreateInputs>>
  readonly context: CreateFlowContext
}): boolean =>
  Match.value(input.step).pipe(
    Match.when("repoUrl", () => {
      input.nextValues.repoUrl = input.buffer
      input.nextValues.outDir = resolveDefaultOutDir(input.context, input.buffer)
      return true
    }),
    Match.when("repoRef", () => {
      input.nextValues.repoRef = input.buffer.length > 0 ? input.buffer : input.currentDefaults.repoRef
      return true
    }),
    Match.when("outDir", () => {
      input.nextValues.outDir = input.buffer.length > 0 ? input.buffer : input.currentDefaults.outDir
      return true
    }),
    Match.when("cpuLimit", () => {
      input.nextValues.cpuLimit = input.buffer.length > 0 ? input.buffer : input.currentDefaults.cpuLimit
      return true
    }),
    Match.when("ramLimit", () => {
      input.nextValues.ramLimit = input.buffer.length > 0 ? input.buffer : input.currentDefaults.ramLimit
      return true
    }),
    Match.when("runUp", () => {
      input.nextValues.runUp = parseYesDefault(input.buffer, input.currentDefaults.runUp)
      return true
    }),
    Match.when("mcpPlaywright", () => {
      input.nextValues.enableMcpPlaywright = parseYesDefault(
        input.buffer,
        input.currentDefaults.enableMcpPlaywright
      )
      return true
    }),
    Match.when("force", () => {
      input.nextValues.force = parseYesDefault(input.buffer, input.currentDefaults.force)
      return true
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
  buffer: string,
  options: AdvanceCreateFlowOptions
): boolean =>
  step === "repoUrl" &&
  buffer.length > 0 &&
  isRepoUrlInput(buffer) &&
  options.forceWizard !== true

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
  const step = createSteps[view.step]
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
  if (!updated) {
    return null
  }

  if (shouldQuickCreate(step, buffer, options)) {
    return {
      _tag: "Complete",
      inputs: resolveCreateInputs(context, nextValues)
    }
  }

  const nextStep = view.step + 1
  if (nextStep < createSteps.length) {
    return continueCreateFlow(nextStep, nextValues)
  }

  return {
    _tag: "Complete",
    inputs: resolveCreateInputs(context, nextValues)
  }
}

export const createProjectDraftFromInputs = (
  input: CreateInputs
): {
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly cpuLimit: string
  readonly ramLimit: string
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
  up: input.runUp,
  enableMcpPlaywright: input.enableMcpPlaywright,
  force: input.force,
  forceEnv: input.forceEnv
})
