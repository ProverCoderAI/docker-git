import { Effect, pipe } from "effect"

import { nextBufferValue } from "./menu-buffer-input.js"
import type { MenuError } from "./menu-errors.js"
import { handleMenuNumberInput, submitPromptStep } from "./menu-input-utils.js"
import {
  type ProjectAuthMenuAction,
  projectAuthMenuActionByIndex,
  projectAuthMenuSize,
  projectAuthSuccessMessage,
  projectAuthViewSteps,
  readProjectAuthSnapshot,
  writeProjectAuthFlow
} from "./menu-project-auth-data.js"
import { resetToMenu } from "./menu-shared.js"
import type {
  MenuEnv,
  MenuKeyInput,
  MenuRunner,
  MenuViewContext,
  ProjectAuthFlow,
  ProjectAuthSnapshot,
  ViewState
} from "./menu-types.js"
import type { ProjectItem } from "./project-item.js"

type ProjectAuthContext = Pick<MenuViewContext, "setView" | "setMessage" | "setActiveDir"> & {
  readonly runner: MenuRunner
}

type ProjectAuthContextWithProject = ProjectAuthContext & {
  readonly project: ProjectItem
}

const startProjectAuthMenu = (
  project: ProjectItem,
  snapshot: ProjectAuthSnapshot,
  context: Pick<MenuViewContext, "setView" | "setMessage">
) => {
  context.setView({ _tag: "ProjectAuthMenu", selected: 0, project, snapshot })
  context.setMessage(null)
}

const startProjectAuthPrompt = (
  project: ProjectItem,
  snapshot: ProjectAuthSnapshot,
  flow: ProjectAuthFlow,
  context: Pick<MenuViewContext, "setView" | "setMessage">
) => {
  context.setView({
    _tag: "ProjectAuthPrompt",
    flow,
    step: 0,
    buffer: "",
    values: {},
    project,
    snapshot
  })
  context.setMessage(null)
}

const loadProjectAuthMenuView = (
  project: ProjectItem,
  context: Pick<MenuViewContext, "setView" | "setMessage">
): Effect.Effect<void, MenuError, MenuEnv> =>
  pipe(
    readProjectAuthSnapshot(project),
    Effect.tap((snapshot) =>
      Effect.sync(() => {
        startProjectAuthMenu(project, snapshot, context)
      })
    ),
    Effect.asVoid
  )

const runProjectAuthEffect = (
  project: ProjectItem,
  flow: ProjectAuthFlow,
  values: Readonly<Record<string, string>>,
  label: string,
  context: ProjectAuthContext
) => {
  context.runner.runEffect(
    pipe(
      writeProjectAuthFlow(project, flow, values),
      Effect.zipRight(readProjectAuthSnapshot(project)),
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          startProjectAuthMenu(project, snapshot, context)
          context.setMessage(projectAuthSuccessMessage(flow, label))
        })
      ),
      Effect.asVoid
    )
  )
}

const submitProjectAuthPrompt = (
  view: Extract<ViewState, { readonly _tag: "ProjectAuthPrompt" }>,
  context: ProjectAuthContext
) => {
  const steps = projectAuthViewSteps(view.flow)
  submitPromptStep(
    view,
    steps,
    context,
    () => {
      startProjectAuthMenu(view.project, view.snapshot, context)
    },
    (nextValues) => {
      const rawLabel = (nextValues["label"] ?? "").trim()
      const label = rawLabel.length > 0 ? rawLabel : "default"
      runProjectAuthEffect(view.project, view.flow, nextValues, label, context)
    }
  )
}

const runProjectAuthAction = (
  action: ProjectAuthMenuAction,
  view: Extract<ViewState, { readonly _tag: "ProjectAuthMenu" }>,
  context: ProjectAuthContext
) => {
  if (action === "Back") {
    resetToMenu(context)
    return
  }
  if (action === "Refresh") {
    context.runner.runEffect(loadProjectAuthMenuView(view.project, context))
    return
  }

  if (
    action === "ProjectGithubDisconnect" ||
    action === "ProjectGitDisconnect" ||
    action === "ProjectClaudeDisconnect" ||
    action === "ProjectGeminiDisconnect" ||
    action === "ProjectGrokDisconnect"
  ) {
    runProjectAuthEffect(view.project, action, {}, "default", context)
    return
  }

  startProjectAuthPrompt(view.project, view.snapshot, action, context)
}

const setProjectAuthMenuSelection = (
  view: Extract<ViewState, { readonly _tag: "ProjectAuthMenu" }>,
  selected: number,
  context: Pick<MenuViewContext, "setView">
) => {
  context.setView({ ...view, selected })
}

const shiftProjectAuthMenuSelection = (
  view: Extract<ViewState, { readonly _tag: "ProjectAuthMenu" }>,
  delta: number,
  context: Pick<MenuViewContext, "setView">
) => {
  const menuSize = projectAuthMenuSize()
  const selected = (view.selected + delta + menuSize) % menuSize
  setProjectAuthMenuSelection(view, selected, context)
}

const runProjectAuthMenuSelection = (
  selected: number,
  view: Extract<ViewState, { readonly _tag: "ProjectAuthMenu" }>,
  context: ProjectAuthContext
) => {
  const action = projectAuthMenuActionByIndex(selected)
  if (action === null) {
    return
  }
  runProjectAuthAction(action, view, context)
}

const handleProjectAuthMenuNumberInput = (
  input: string,
  view: Extract<ViewState, { readonly _tag: "ProjectAuthMenu" }>,
  context: ProjectAuthContext
) => {
  handleMenuNumberInput(
    input,
    context,
    projectAuthMenuActionByIndex,
    (action) => {
      runProjectAuthAction(action, view, context)
    }
  )
}

const handleProjectAuthMenuInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "ProjectAuthMenu" }>,
  context: ProjectAuthContext
) => {
  if (key.escape) {
    resetToMenu(context)
    return
  }
  if (key.upArrow) {
    shiftProjectAuthMenuSelection(view, -1, context)
    return
  }
  if (key.downArrow) {
    shiftProjectAuthMenuSelection(view, 1, context)
    return
  }
  if (key.return) {
    runProjectAuthMenuSelection(view.selected, view, context)
    return
  }
  handleProjectAuthMenuNumberInput(input, view, context)
}

type SetPromptBufferArgs = {
  readonly input: string
  readonly key: MenuKeyInput
  readonly view: Extract<ViewState, { readonly _tag: "ProjectAuthPrompt" }>
  readonly context: Pick<MenuViewContext, "setView">
}

const setProjectAuthPromptBuffer = (args: SetPromptBufferArgs) => {
  const nextBuffer = nextBufferValue(args.input, args.key, args.view.buffer)
  if (nextBuffer === null) {
    return
  }
  args.context.setView({ ...args.view, buffer: nextBuffer })
}

const handleProjectAuthPromptInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "ProjectAuthPrompt" }>,
  context: ProjectAuthContext
) => {
  if (key.escape) {
    startProjectAuthMenu(view.project, view.snapshot, context)
    return
  }
  if (key.return) {
    submitProjectAuthPrompt(view, context)
    return
  }
  setProjectAuthPromptBuffer({ input, key, view, context })
}

export const openProjectAuthMenu = (context: ProjectAuthContextWithProject): void => {
  context.setMessage(`Loading project auth (${context.project.displayName})...`)
  context.runner.runEffect(loadProjectAuthMenuView(context.project, context))
}

export const openProjectAuthSelection = (
  project: ProjectItem,
  context: ProjectAuthContext
): void => {
  openProjectAuthMenu({ project, ...context })
}

export const handleProjectAuthInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "ProjectAuthMenu" | "ProjectAuthPrompt" }>,
  context: ProjectAuthContext
) => {
  if (view._tag === "ProjectAuthMenu") {
    handleProjectAuthMenuInput(input, key, view, context)
    return
  }
  handleProjectAuthPromptInput(input, key, view, context)
}
