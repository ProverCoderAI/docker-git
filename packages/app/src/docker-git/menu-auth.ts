import { Effect, pipe } from "effect"

import { authGithubLogin } from "@effect-template/lib/usecases/auth"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { renderError } from "@effect-template/lib/usecases/errors"

import {
  type AuthMenuAction,
  authMenuActionByIndex,
  authMenuSize,
  authViewSteps,
  readAuthSnapshot,
  successMessage,
  writeAuthFlow
} from "./menu-auth-data.js"
import { nextBufferValue } from "./menu-buffer-input.js"
import { handleMenuNumberInput, submitPromptStep } from "./menu-input-utils.js"
import { pauseForEnter, resetToMenu, resumeTui, suspendTui, writeToTerminal } from "./menu-shared.js"
import type {
  AuthFlow,
  AuthSnapshot,
  MenuEnv,
  MenuKeyInput,
  MenuRunner,
  MenuState,
  MenuViewContext,
  ViewState
} from "./menu-types.js"

type AuthContext = MenuViewContext & {
  readonly state: MenuState
  readonly runner: MenuRunner
}

type AuthInputContext = AuthContext & {
  readonly setSshActive: (active: boolean) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
}

type AuthPromptView = Extract<ViewState, { readonly _tag: "AuthPrompt" }>

const defaultLabel = (value: string): string => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : "default"
}

const startAuthMenuWithSnapshot = (
  snapshot: AuthSnapshot,
  context: Pick<MenuViewContext, "setView" | "setMessage">
) => {
  context.setView({ _tag: "AuthMenu", selected: 0, snapshot })
  context.setMessage(null)
}

const startAuthPrompt = (
  snapshot: AuthSnapshot,
  flow: AuthFlow,
  context: Pick<MenuViewContext, "setView" | "setMessage">
) => {
  context.setView({
    _tag: "AuthPrompt",
    flow,
    step: 0,
    buffer: "",
    values: {},
    snapshot
  })
  context.setMessage(null)
}

const resolveAuthPromptEffect = (
  view: AuthPromptView,
  cwd: string,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, AppError, MenuEnv> => {
  if (view.flow === "GithubOauth") {
    const labelValue = (values["label"] ?? "").trim()
    const labelOption = labelValue.length > 0 ? labelValue : null
    return authGithubLogin({
      _tag: "AuthGithubLogin",
      label: labelOption,
      token: null,
      scopes: null,
      envGlobalPath: view.snapshot.globalEnvPath
    })
  }
  return writeAuthFlow(cwd, view.flow, values)
}

const runAuthPromptEffect = (
  effect: Effect.Effect<void, AppError, MenuEnv>,
  view: AuthPromptView,
  label: string,
  context: AuthInputContext,
  options: { readonly suspendTui: boolean }
) => {
  const withOptionalSuspension = options.suspendTui
    ? pipe(
      Effect.sync(() => {
        suspendTui()
      }),
      Effect.zipRight(
        pipe(
          effect,
          Effect.tapError((error) =>
            Effect.ignore(
              pipe(
                Effect.sync(() => {
                  writeToTerminal(`\n[docker-git] ${renderError(error)}\n`)
                }),
                Effect.zipRight(pauseForEnter())
              )
            )
          )
        )
      ),
      Effect.ensuring(
        Effect.sync(() => {
          resumeTui()
          context.setSshActive(false)
          context.setSkipInputs(() => 2)
        })
      )
    )
    : effect

  if (options.suspendTui) {
    context.setSshActive(true)
  }
  context.runner.runEffect(
    pipe(
      withOptionalSuspension,
      Effect.zipRight(readAuthSnapshot(context.state.cwd)),
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          startAuthMenuWithSnapshot(snapshot, context)
          context.setMessage(successMessage(view.flow, label))
        })
      ),
      Effect.asVoid
    )
  )
}

const loadAuthMenuView = (
  cwd: string,
  context: Pick<MenuViewContext, "setView" | "setMessage">
): Effect.Effect<void, AppError, MenuEnv> =>
  pipe(
    readAuthSnapshot(cwd),
    Effect.tap((snapshot) =>
      Effect.sync(() => {
        startAuthMenuWithSnapshot(snapshot, context)
      })
    ),
    Effect.asVoid
  )

const runAuthAction = (
  action: AuthMenuAction,
  view: Extract<ViewState, { readonly _tag: "AuthMenu" }>,
  context: AuthContext
) => {
  if (action === "Back") {
    resetToMenu(context)
    return
  }
  if (action === "Refresh") {
    context.runner.runEffect(loadAuthMenuView(context.state.cwd, context))
    return
  }
  startAuthPrompt(view.snapshot, action, context)
}

const submitAuthPrompt = (
  view: AuthPromptView,
  context: AuthInputContext
) => {
  const steps = authViewSteps(view.flow)
  submitPromptStep(
    view,
    steps,
    context,
    () => {
      startAuthMenuWithSnapshot(view.snapshot, context)
    },
    (nextValues) => {
      const label = defaultLabel(nextValues["label"] ?? "")
      const effect = resolveAuthPromptEffect(view, context.state.cwd, nextValues)
      runAuthPromptEffect(effect, view, label, context, { suspendTui: view.flow === "GithubOauth" })
    }
  )
}

const setAuthMenuSelection = (
  view: Extract<ViewState, { readonly _tag: "AuthMenu" }>,
  selected: number,
  context: AuthContext
) => {
  context.setView({
    ...view,
    selected
  })
}

const shiftAuthMenuSelection = (
  view: Extract<ViewState, { readonly _tag: "AuthMenu" }>,
  delta: number,
  context: AuthContext
) => {
  const menuSize = authMenuSize()
  const selected = (view.selected + delta + menuSize) % menuSize
  setAuthMenuSelection(view, selected, context)
}

const runAuthMenuSelection = (
  selected: number,
  view: Extract<ViewState, { readonly _tag: "AuthMenu" }>,
  context: AuthContext
) => {
  const action = authMenuActionByIndex(selected)
  if (action === null) {
    return
  }
  runAuthAction(action, view, context)
}

const handleAuthMenuNumberInput = (
  input: string,
  view: Extract<ViewState, { readonly _tag: "AuthMenu" }>,
  context: AuthContext
) => {
  handleMenuNumberInput(input, context, authMenuActionByIndex, (action) => {
    runAuthAction(action, view, context)
  })
}

const handleAuthMenuInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "AuthMenu" }>,
  context: AuthContext
) => {
  if (key.escape) {
    resetToMenu(context)
    return
  }
  if (key.upArrow) {
    shiftAuthMenuSelection(view, -1, context)
    return
  }
  if (key.downArrow) {
    shiftAuthMenuSelection(view, 1, context)
    return
  }
  if (key.return) {
    runAuthMenuSelection(view.selected, view, context)
    return
  }
  handleAuthMenuNumberInput(input, view, context)
}

const handleAuthPromptInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "AuthPrompt" }>,
  context: AuthInputContext
) => {
  if (key.escape) {
    startAuthMenuWithSnapshot(view.snapshot, context)
    return
  }
  if (key.return) {
    submitAuthPrompt(view, context)
    return
  }
  setAuthPromptBuffer({ input, key, view, context })
}

type SetAuthPromptBufferArgs = {
  readonly input: string
  readonly key: MenuKeyInput
  readonly view: Extract<ViewState, { readonly _tag: "AuthPrompt" }>
  readonly context: Pick<MenuViewContext, "setView">
}

const setAuthPromptBuffer = (
  args: SetAuthPromptBufferArgs
) => {
  const { context, input, key, view } = args
  const nextBuffer = nextBufferValue(input, key, view.buffer)
  if (nextBuffer === null) {
    return
  }
  context.setView({ ...view, buffer: nextBuffer })
}

export const openAuthMenu = (context: AuthContext): void => {
  context.setMessage("Loading auth profiles...")
  context.runner.runEffect(loadAuthMenuView(context.state.cwd, context))
}

export const handleAuthInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "AuthMenu" | "AuthPrompt" }>,
  context: AuthInputContext
) => {
  if (view._tag === "AuthMenu") {
    handleAuthMenuInput(input, key, view, context)
    return
  }
  handleAuthPromptInput(input, key, view, context)
}
