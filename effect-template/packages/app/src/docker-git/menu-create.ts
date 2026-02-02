import { type CreateCommand, deriveRepoPathParts } from "@effect-template/lib/core/domain"
import { parseArgs } from "@effect-template/lib/core/parser"
import { formatParseError, usageText } from "@effect-template/lib/core/usage"
import { createProject } from "@effect-template/lib/usecases/actions"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import * as Path from "@effect/platform/Path"
import { Effect, Either, Match, pipe } from "effect"

import { resetToMenu } from "./menu-shared.js"
import {
  type CreateInputs,
  type CreateStep,
  createSteps,
  type MenuEnv,
  type MenuState,
  type ViewState
} from "./menu-types.js"

// CHANGE: move create-flow handling into a dedicated module
// WHY: keep TUI entry slim and satisfy lint constraints
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall s: step(s) -> step'(s)
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: outDir resolves to a stable repo path
// COMPLEXITY: O(1) per keypress

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

type CreateRunner = { readonly runEffect: (effect: Effect.Effect<void, AppError, MenuEnv>) => void }

type CreateContext = {
  readonly state: MenuState
  readonly setView: (view: ViewState) => void
  readonly setMessage: (message: string | null) => void
  readonly runner: CreateRunner
  readonly setActiveDir: (dir: string | null) => void
}

type CreateReturnContext = CreateContext & {
  readonly view: Extract<ViewState, { readonly _tag: "Create" }>
}

export const buildCreateArgs = (input: CreateInputs): ReadonlyArray<string> => {
  const args: Array<string> = ["create", "--repo-url", input.repoUrl, "--secrets-root", input.secretsRoot]
  if (input.repoRef.length > 0) {
    args.push("--repo-ref", input.repoRef)
  }
  args.push("--out-dir", input.outDir)
  if (!input.runUp) {
    args.push("--no-up")
  }
  if (input.force) {
    args.push("--force")
  }
  return args
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

const resolveDefaultOutDir = (cwd: string, repoUrl: string): string => {
  const repoPath = deriveRepoPathParts(repoUrl).pathParts
  return joinPath(defaultProjectsRoot(cwd), ...repoPath)
}

export const resolveCreateInputs = (
  cwd: string,
  values: Partial<CreateInputs>
): CreateInputs => {
  const repoUrl = values.repoUrl ?? ""
  const secretsRoot = values.secretsRoot ?? joinPath(defaultProjectsRoot(cwd), "secrets")
  const outDir = values.outDir ?? (repoUrl.length > 0 ? resolveDefaultOutDir(cwd, repoUrl) : "")

  return {
    repoUrl,
    repoRef: values.repoRef ?? "main",
    outDir,
    secretsRoot,
    runUp: values.runUp ?? true,
    force: values.force ?? false
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

const applyCreateCommand = (
  state: MenuState,
  create: CreateCommand
): Effect.Effect<{ readonly _tag: "Continue"; readonly state: MenuState }, AppError, MenuEnv> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const resolvedOutDir = path.resolve(create.outDir)
    yield* _(createProject(create))
    return { _tag: "Continue", state: { ...state, activeDir: resolvedOutDir } }
  })

const isCreateCommand = (command: { readonly _tag: string }): command is CreateCommand => command._tag === "Create"

const buildCreateEffect = (
  command: { readonly _tag: string },
  state: MenuState,
  setActiveDir: (dir: string | null) => void,
  setMessage: (message: string | null) => void
): Effect.Effect<void, AppError, MenuEnv> => {
  if (isCreateCommand(command)) {
    return pipe(
      applyCreateCommand(state, command),
      Effect.tap((outcome) =>
        Effect.sync(() => {
          setActiveDir(outcome.state.activeDir)
        })
      ),
      Effect.asVoid
    )
  }
  if (command._tag === "Help") {
    return Effect.sync(() => {
      setMessage(usageText)
    })
  }
  return Effect.void
}

const applyCreateStep = (input: {
  readonly step: CreateStep
  readonly buffer: string
  readonly currentDefaults: CreateInputs
  readonly nextValues: Partial<Mutable<CreateInputs>>
  readonly cwd: string
  readonly setMessage: (message: string | null) => void
}): boolean =>
  Match.value(input.step).pipe(
    Match.when("repoUrl", () => {
      if (input.buffer.length === 0) {
        input.setMessage("Repo URL is required.")
        return false
      }
      input.nextValues.repoUrl = input.buffer
      input.nextValues.outDir = resolveDefaultOutDir(input.cwd, input.buffer)
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
    Match.when("runUp", () => {
      input.nextValues.runUp = parseYesDefault(input.buffer, input.currentDefaults.runUp)
      return true
    }),
    Match.when("force", () => {
      input.nextValues.force = parseYesDefault(input.buffer, input.currentDefaults.force)
      return true
    }),
    Match.exhaustive
  )

const finalizeCreateFlow = (input: {
  readonly state: MenuState
  readonly nextValues: Partial<CreateInputs>
  readonly setView: (view: ViewState) => void
  readonly setMessage: (message: string | null) => void
  readonly runner: CreateRunner
  readonly setActiveDir: (dir: string | null) => void
}) => {
  const inputs = resolveCreateInputs(input.state.cwd, input.nextValues)
  if (inputs.repoUrl.length === 0) {
    input.setMessage("Repo URL is required.")
    return
  }

  const parsed = parseArgs(buildCreateArgs(inputs))
  if (Either.isLeft(parsed)) {
    input.setMessage(formatParseError(parsed.left))
    input.setView({ _tag: "Menu" })
    return
  }

  const effect = buildCreateEffect(parsed.right, input.state, input.setActiveDir, input.setMessage)
  input.runner.runEffect(effect)
  input.setView({ _tag: "Menu" })
  input.setMessage(null)
}

const handleCreateReturn = (context: CreateReturnContext) => {
  const step = createSteps[context.view.step]
  if (!step) {
    context.setView({ _tag: "Menu" })
    return
  }

  const buffer = context.view.buffer.trim()
  const currentDefaults = resolveCreateInputs(context.state.cwd, context.view.values)
  const nextValues: Partial<Mutable<CreateInputs>> = { ...context.view.values }
  const updated = applyCreateStep({
    step,
    buffer,
    currentDefaults,
    nextValues,
    cwd: context.state.cwd,
    setMessage: context.setMessage
  })
  if (!updated) {
    return
  }

  const nextStep = context.view.step + 1
  if (nextStep < createSteps.length) {
    context.setView({ _tag: "Create", step: nextStep, buffer: "", values: nextValues })
    context.setMessage(null)
    return
  }

  finalizeCreateFlow({
    state: context.state,
    nextValues,
    setView: context.setView,
    setMessage: context.setMessage,
    runner: context.runner,
    setActiveDir: context.setActiveDir
  })
}

export const startCreateView = (
  setView: (view: ViewState) => void,
  setMessage: (message: string | null) => void,
  buffer = ""
) => {
  setView({ _tag: "Create", step: 0, buffer, values: {} })
  setMessage(null)
}

export const handleCreateInput = (
  input: string,
  key: {
    readonly escape?: boolean
    readonly return?: boolean
    readonly backspace?: boolean
    readonly delete?: boolean
  },
  view: Extract<ViewState, { readonly _tag: "Create" }>,
  context: CreateContext
) => {
  if (key.escape) {
    resetToMenu(context)
    return
  }
  if (key.return) {
    handleCreateReturn({ ...context, view })
    return
  }

  if (key.backspace || key.delete) {
    context.setView({ ...view, buffer: view.buffer.slice(0, -1) })
    return
  }

  if (input.length > 0) {
    context.setView({ ...view, buffer: view.buffer + input })
  }
}
