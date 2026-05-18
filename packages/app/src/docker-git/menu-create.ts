import { Effect, Either, pipe } from "effect"
import { type CreateCommand } from "./frontend-lib/core/domain.js"

import { createProject as createProjectViaApi } from "./api-client.js"
import { parseArgs } from "./cli/parser.js"
import { formatParseError, usageText } from "./cli/usage.js"
import type { MenuError } from "./menu-errors.js"

import { nextBufferValue } from "./menu-buffer-input.js"
import {
  advanceCreateFlow,
  createInitialFlowView,
  handleAdvanceCreateFlowResult,
  moveCreateSettingsStep,
  resolveCreateInputs
} from "./menu-create-shared.js"
import { resetToMenu } from "./menu-shared.js"
import { type CreateInputs, type MenuEnv, type MenuState, type ViewState } from "./menu-types.js"

// CHANGE: move create-flow handling into a dedicated module
// WHY: keep TUI entry slim and satisfy lint constraints
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall s: step(s) -> step'(s)
// PURITY: SHELL
// EFFECT: Effect<void, MenuError, FileSystem | Path | CommandExecutor>
// INVARIANT: outDir resolves to a stable repo path
// COMPLEXITY: O(1) per keypress

type CreateRunner = { readonly runEffect: <E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) => void }

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

type OptionalCreateArg = {
  readonly value: string
  readonly args: readonly [string, string]
}

const optionalCreateArgs = (input: CreateInputs): ReadonlyArray<OptionalCreateArg> => [
  { value: input.repoUrl, args: ["--repo-url", input.repoUrl] },
  { value: input.repoRef, args: ["--repo-ref", input.repoRef] },
  { value: input.outDir, args: ["--out-dir", input.outDir] },
  { value: input.cpuLimit, args: ["--cpu", input.cpuLimit] },
  { value: input.ramLimit, args: ["--ram", input.ramLimit] },
  { value: input.gpu === "all" ? input.gpu : "", args: ["--gpu", input.gpu] }
]

const booleanCreateFlags = (input: CreateInputs): ReadonlyArray<string> =>
  [
    input.runUp ? null : "--no-up",
    input.enableMcpPlaywright ? "--mcp-playwright" : null,
    input.force ? "--force" : null,
    input.forceEnv ? "--force-env" : null
  ].filter((value): value is string => value !== null)

export const buildCreateArgs = (input: CreateInputs): ReadonlyArray<string> => {
  const args: Array<string> = ["create"]

  for (const spec of optionalCreateArgs(input)) {
    if (spec.value.length > 0) {
      args.push(spec.args[0], spec.args[1])
    }
  }

  for (const flag of booleanCreateFlags(input)) {
    args.push(flag)
  }
  return args
}

const applyCreateCommand = (
  state: MenuState,
  create: CreateCommand
): Effect.Effect<{ readonly _tag: "Continue"; readonly state: MenuState }, MenuError, MenuEnv> =>
  Effect.gen(function*(_) {
    const project = yield* _(createProjectViaApi(create))
    return {
      _tag: "Continue",
      state: { ...state, activeDir: project?.projectDir ?? create.outDir }
    }
  })

const isCreateCommand = (command: { readonly _tag: string }): command is CreateCommand => command._tag === "Create"

const buildCreateEffect = (
  command: { readonly _tag: string },
  state: MenuState,
  setActiveDir: (dir: string | null) => void,
  setMessage: (message: string | null) => void
): Effect.Effect<void, MenuError, MenuEnv> => {
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

const finalizeCreateFlow = (input: {
  readonly state: MenuState
  readonly nextValues: Partial<CreateInputs>
  readonly setView: (view: ViewState) => void
  readonly setMessage: (message: string | null) => void
  readonly runner: CreateRunner
  readonly setActiveDir: (dir: string | null) => void
}) => {
  const inputs = resolveCreateInputs(input.state.cwd, input.nextValues)
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

const handleCreateReturn = (
  context: CreateReturnContext,
  quickCreate = false
) => {
  const next = advanceCreateFlow(context.state.cwd, context.view, { quickCreate })
  handleAdvanceCreateFlowResult(next, {
    onComplete: (inputs) => {
      finalizeCreateFlow({
        state: context.state,
        nextValues: inputs,
        setView: context.setView,
        setMessage: context.setMessage,
        runner: context.runner,
        setActiveDir: context.setActiveDir
      })
    },
    onContinue: (view) => {
      context.setView({ _tag: "Create", ...view })
      context.setMessage(null)
    },
    onError: (error) => {
      context.setMessage(formatParseError(error))
    }
  })
}

export const startCreateView = (
  setView: (view: ViewState) => void,
  setMessage: (message: string | null) => void,
  buffer = ""
) => {
  setView({ _tag: "Create", ...createInitialFlowView(buffer) })
  setMessage(null)
}

export const handleCreateInput = (
  input: string,
  key: {
    readonly escape?: boolean
    readonly upArrow?: boolean
    readonly downArrow?: boolean
    readonly return?: boolean
    readonly shift?: boolean
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
  if (key.upArrow || key.downArrow) {
    const nextView = moveCreateSettingsStep(view, key.upArrow ? "up" : "down")
    if (nextView !== null) {
      context.setView({ _tag: "Create", ...nextView })
      context.setMessage(null)
    }
    return
  }
  if (key.return) {
    handleCreateReturn({ ...context, view }, key.shift === true)
    return
  }
  const nextBuffer = nextBufferValue(input, key, view.buffer)
  if (nextBuffer !== null) {
    context.setView({ ...view, buffer: nextBuffer })
  }
}

export { resolveCreateInputs } from "./menu-create-shared.js"
