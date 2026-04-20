import { NodeContext } from "@effect/platform-node"
import { Effect, pipe } from "effect"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { GridlandModule } from "@gridland/bun"

import { listMenuProjectItems, renderMenuProjectSummaries } from "./menu-api.js"
import { renderCreateStepLabel, resolveCreateInputs } from "./menu-create-shared.js"
import type { MenuError } from "./menu-errors.js"
import { renderMenuError } from "./menu-errors.js"
import { GridlandMenuProvider, runGridlandMenu, useGridlandMenuInput } from "./menu-gridland-runtime.js"
import type { InputStage } from "./menu-input-handler.js"
import {
  renderAuthMenu,
  renderAuthPrompt,
  renderCreate,
  renderMenu,
  renderProjectAuthMenu,
  renderProjectAuthPrompt,
  renderSelect
} from "./menu-render.js"
import { leaveTui, writeErrorAndPause } from "./menu-shared.js"
import { defaultMenuStartupSnapshot, resolveMenuStartupSnapshot } from "./menu-startup.js"
import { createSteps, type MenuEnv, type MenuState, type ViewState } from "./menu-types.js"

type InteractiveMenuEffect = Effect.Effect<void, never, MenuEnv>

type QueueInteractiveEffect = (effect: InteractiveMenuEffect) => void

type MenuSnapshot = {
  readonly activeDir: string | null
  readonly runningDockerGitContainers: number
  readonly selected: number
  readonly busy: boolean
  readonly message: string | null
  readonly view: ViewState
  readonly inputStage: InputStage
  readonly ready: boolean
  readonly skipInputs: number
  readonly sshActive: boolean
  readonly startupLoaded: boolean
}

type MenuSnapshotStore = {
  current: MenuSnapshot
}

const defaultMenuSnapshot = (): MenuSnapshot => ({
  activeDir: null,
  runningDockerGitContainers: 0,
  selected: 0,
  busy: false,
  message: null,
  view: { _tag: "Menu" },
  inputStage: "cold",
  ready: false,
  skipInputs: 2,
  sshActive: false,
  startupLoaded: false
})

const gridlandBootstrapError = (message: string): MenuError => ({
  _tag: "TerminalSessionClientError",
  message
})

// CHANGE: keep menu state in the TUI layer
// WHY: provide a dynamic interface with live selection and inputs
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall s: input(s) -> state'(s)
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: activeDir updated only after successful create
// COMPLEXITY: O(1) per keypress

const useRunner = (
  setBusy: (busy: boolean) => void,
  setMessage: (message: string | null) => void,
  queueInteractiveEffect: QueueInteractiveEffect
) => {
  const runEffect = useCallback(
    function<E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) {
      setBusy(true)
      const program = pipe(
        effect,
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.sync(() => {
              setMessage(renderMenuError(error))
            }),
          onSuccess: () => Effect.void
        }),
        Effect.ensuring(
          Effect.sync(() => {
            setBusy(false)
          })
        )
      )
      void Effect.runPromise(Effect.provide(program, NodeContext.layer))
    },
    [setBusy, setMessage]
  )

  const runInteractiveEffect = useCallback(
    function<E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) {
      setBusy(true)
      queueInteractiveEffect(
        pipe(
          effect,
          Effect.matchEffect({
            onFailure: (error) => {
              const message = renderMenuError(error)
              return pipe(
                writeErrorAndPause(message),
                Effect.zipRight(
                  Effect.sync(() => {
                    setMessage(message)
                  })
                )
              )
            },
            onSuccess: () => Effect.void
          }),
          Effect.ensuring(
            Effect.sync(() => {
              setBusy(false)
            })
          )
        )
      )
    },
    [queueInteractiveEffect, setBusy, setMessage]
  )

  return useMemo(
    () => ({
      runEffect,
      runInteractiveEffect
    }),
    [runEffect, runInteractiveEffect]
  )
}

type RenderContext = {
  readonly state: MenuState
  readonly view: ViewState
  readonly activeDir: string | null
  readonly runningDockerGitContainers: number
  readonly selected: number
  readonly busy: boolean
  readonly message: string | null
}

const renderView = (context: RenderContext) => {
  if (context.view._tag === "Menu") {
    return renderMenu({
      cwd: context.state.cwd,
      activeDir: context.activeDir,
      runningDockerGitContainers: context.runningDockerGitContainers,
      selected: context.selected,
      busy: context.busy,
      message: context.message
    })
  }

  if (context.view._tag === "Create") {
    const currentDefaults = resolveCreateInputs(context.state.cwd, context.view.values)
    const step = createSteps[context.view.step] ?? "repoUrl"
    const label = renderCreateStepLabel(step, currentDefaults)

    return renderCreate(label, context.view.buffer, context.message, context.view.step, currentDefaults)
  }

  if (context.view._tag === "AuthMenu") {
    return renderAuthMenu(context.view.snapshot, context.view.selected, context.message)
  }

  if (context.view._tag === "AuthPrompt") {
    return renderAuthPrompt(context.view, context.message)
  }

  if (context.view._tag === "ProjectAuthMenu") {
    return renderProjectAuthMenu(context.view.snapshot, context.view.selected, context.message)
  }

  if (context.view._tag === "ProjectAuthPrompt") {
    return renderProjectAuthPrompt(context.view, context.message)
  }

  return renderSelect({
    purpose: context.view.purpose,
    items: context.view.items,
    selected: context.view.selected,
    runtimeByProject: context.view.runtimeByProject,
    confirmDelete: context.view.confirmDelete,
    connectEnableMcpPlaywright: context.view.connectEnableMcpPlaywright,
    message: context.message
  })
}

const useMenuState = (store: MenuSnapshotStore, queueInteractiveEffect: QueueInteractiveEffect) => {
  const [activeDir, setActiveDirState] = useState(store.current.activeDir)
  const [runningDockerGitContainers, setRunningDockerGitContainersState] = useState(
    store.current.runningDockerGitContainers
  )
  const [selected, setSelectedState] = useState(store.current.selected)
  const [busy, setBusyState] = useState(store.current.busy)
  const [message, setMessageState] = useState(store.current.message)
  const [view, setViewState] = useState<ViewState>(store.current.view)
  const [inputStage, setInputStageState] = useState<InputStage>(store.current.inputStage)
  const [ready, setReadyState] = useState(store.current.ready)
  const [skipInputs, setSkipInputsState] = useState(store.current.skipInputs)
  const [sshActive, setSshActiveState] = useState(store.current.sshActive)
  const mountedRef = useRef(true)

  const updateSnapshot = useCallback(
    (update: (snapshot: MenuSnapshot) => MenuSnapshot) => {
      store.current = update(store.current)
    },
    [store]
  )

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const setActiveDir = useCallback(
    (value: string | null) => {
      updateSnapshot((snapshot) => ({ ...snapshot, activeDir: value }))
      if (mountedRef.current) {
        setActiveDirState(value)
      }
    },
    [updateSnapshot]
  )

  const setRunningDockerGitContainers = useCallback(
    (value: number) => {
      updateSnapshot((snapshot) => ({ ...snapshot, runningDockerGitContainers: value }))
      if (mountedRef.current) {
        setRunningDockerGitContainersState(value)
      }
    },
    [updateSnapshot]
  )

  const setSelected = useCallback(
    (update: (value: number) => number) => {
      const nextValue = update(store.current.selected)
      updateSnapshot((snapshot) => ({ ...snapshot, selected: nextValue }))
      if (mountedRef.current) {
        setSelectedState(nextValue)
      }
    },
    [store, updateSnapshot]
  )

  const setBusy = useCallback(
    (value: boolean) => {
      updateSnapshot((snapshot) => ({ ...snapshot, busy: value }))
      if (mountedRef.current) {
        setBusyState(value)
      }
    },
    [updateSnapshot]
  )

  const setMessage = useCallback(
    (value: string | null) => {
      updateSnapshot((snapshot) => ({ ...snapshot, message: value }))
      if (mountedRef.current) {
        setMessageState(value)
      }
    },
    [updateSnapshot]
  )

  const setView = useCallback(
    (value: ViewState) => {
      updateSnapshot((snapshot) => ({ ...snapshot, view: value }))
      if (mountedRef.current) {
        setViewState(value)
      }
    },
    [updateSnapshot]
  )

  const setInputStage = useCallback(
    (value: InputStage) => {
      updateSnapshot((snapshot) => ({ ...snapshot, inputStage: value }))
      if (mountedRef.current) {
        setInputStageState(value)
      }
    },
    [updateSnapshot]
  )

  const setReady = useCallback(
    (value: boolean) => {
      updateSnapshot((snapshot) => ({ ...snapshot, ready: value }))
      if (mountedRef.current) {
        setReadyState(value)
      }
    },
    [updateSnapshot]
  )

  const setSkipInputs = useCallback(
    (update: (value: number) => number) => {
      const nextValue = update(store.current.skipInputs)
      updateSnapshot((snapshot) => ({ ...snapshot, skipInputs: nextValue }))
      if (mountedRef.current) {
        setSkipInputsState(nextValue)
      }
    },
    [store, updateSnapshot]
  )

  const setSshActive = useCallback(
    (value: boolean) => {
      updateSnapshot((snapshot) => ({ ...snapshot, sshActive: value }))
      if (mountedRef.current) {
        setSshActiveState(value)
      }
    },
    [updateSnapshot]
  )

  const ignoreUntil = useMemo(() => Date.now() + 400, [])
  const state = useMemo<MenuState>(() => ({ cwd: process.cwd(), activeDir }), [activeDir])
  const runner = useRunner(setBusy, setMessage, queueInteractiveEffect)

  return {
    activeDir,
    setActiveDir,
    runningDockerGitContainers,
    setRunningDockerGitContainers,
    selected,
    setSelected,
    busy,
    message,
    setMessage,
    view,
    setView,
    inputStage,
    setInputStage,
    ready,
    setReady,
    skipInputs,
    setSkipInputs,
    sshActive,
    setSshActive,
    ignoreUntil,
    state,
    runner
  }
}

const useReadyGate = (setReady: (ready: boolean) => void) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true)
    }, 150)
    return () => {
      clearTimeout(timer)
    }
  }, [setReady])
}

const useStartupSnapshot = (
  store: MenuSnapshotStore,
  setActiveDir: (value: string | null) => void,
  setRunningDockerGitContainers: (value: number) => void,
  setMessage: (message: string | null) => void
) => {
  useEffect(() => {
    if (store.current.startupLoaded) {
      return
    }

    let cancelled = false

    const startup = pipe(
      listMenuProjectItems,
      Effect.map((items) => resolveMenuStartupSnapshot(items)),
      Effect.match({
        onFailure: (error: MenuError) => ({
          ...defaultMenuStartupSnapshot(),
          message: renderMenuError(error)
        }),
        onSuccess: (snapshot) => snapshot
      }),
      Effect.provide(NodeContext.layer)
    )

    void Effect.runPromise(startup).then((snapshot) => {
      if (cancelled) {
        return
      }
      store.current = {
        ...store.current,
        startupLoaded: true
      }
      setRunningDockerGitContainers(snapshot.runningDockerGitContainers)
      setMessage(snapshot.message)
      if (snapshot.activeDir !== null) {
        setActiveDir(snapshot.activeDir)
      }
    })

    return () => {
      cancelled = true
    }
  }, [setActiveDir, setMessage, setRunningDockerGitContainers, store])
}

const useSigintGuard = (exit: () => void, sshActive: boolean) => {
  useEffect(() => {
    const handleSigint = () => {
      if (sshActive) {
        return
      }
      exit()
    }
    process.on("SIGINT", handleSigint)
    return () => {
      process.off("SIGINT", handleSigint)
    }
  }, [exit, sshActive])
}

type GridlandTuiAppProps = {
  readonly exit: () => void
  readonly gridland: GridlandModule
  readonly store: MenuSnapshotStore
  readonly queueInteractiveEffect: QueueInteractiveEffect
}

const GridlandTuiApp = ({ exit, gridland, queueInteractiveEffect, store }: GridlandTuiAppProps) => {
  const requestInteractiveEffect = useCallback(
    (effect: InteractiveMenuEffect) => {
      queueInteractiveEffect(effect)
      exit()
    },
    [exit, queueInteractiveEffect]
  )
  const menu = useMenuState(store, requestInteractiveEffect)

  useReadyGate(menu.setReady)
  useStartupSnapshot(store, menu.setActiveDir, menu.setRunningDockerGitContainers, menu.setMessage)
  useSigintGuard(exit, menu.sshActive)
  useGridlandMenuInput(gridland, { ...menu, exit })

  return React.createElement(
    GridlandMenuProvider,
    {
      children: renderView({
        state: menu.state,
        view: menu.view,
        activeDir: menu.activeDir,
        runningDockerGitContainers: menu.runningDockerGitContainers,
        selected: menu.selected,
        busy: menu.busy,
        message: menu.message
      }),
      gridland
    }
  )
}

const runGridlandMenuOnce = (
  store: MenuSnapshotStore,
  queueInteractiveEffect: QueueInteractiveEffect
): Effect.Effect<void, MenuError, MenuEnv> =>
  pipe(
    runGridlandMenu((args) =>
      React.createElement(GridlandTuiApp, {
        ...args,
        store,
        queueInteractiveEffect
      })
    ),
    Effect.mapError((error) => gridlandBootstrapError(error.message)),
    Effect.ensuring(
      Effect.sync(() => {
        leaveTui()
      })
    ),
    Effect.asVoid
  )

const restoreMenuAfterInteractiveEffect = (store: MenuSnapshotStore): void => {
  store.current = {
    ...store.current,
    busy: false,
    ready: false,
    skipInputs: 2,
    sshActive: false
  }
}

// CHANGE: provide an interactive TUI menu for docker-git
// WHY: allow dynamic selection and inline create flow without raw prompts
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall s: tui(s) -> state transitions
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: app exits only on Quit or ctrl+c
// COMPLEXITY: O(1) per input
//
// CHANGE: guard against non-TTY environments (Docker without -t)
// WHY: interactive Gridland host still requires a real TTY; without one
//      fall back to the project summary renderer.
// QUOTE(ТЗ): "вечный цикл зависания на TUI из за ошибки Raw mode is not supported"
// REF: issue-100
// SOURCE: n/a
// FORMAT THEOREM: ∀ env: isTTY(env) → renderTui ∧ ¬isTTY(env) → listProjects(api)
// INVARIANT: Gridland host only starts when stdin.isTTY ∧ stdout.isTTY
const runInteractiveMenu = (): Effect.Effect<void, MenuError, MenuEnv> =>
  Effect.gen(function*(_) {
    const store: MenuSnapshotStore = { current: defaultMenuSnapshot() }
    const queuedInteractiveEffect: { current: InteractiveMenuEffect | null } = { current: null }
    let keepRunning = true

    while (keepRunning) {
      yield* _(
        runGridlandMenuOnce(store, (effect) => {
          queuedInteractiveEffect.current = effect
        })
      )

      const nextInteractiveEffect = queuedInteractiveEffect.current
      if (nextInteractiveEffect === null) {
        keepRunning = false
        continue
      }

      queuedInteractiveEffect.current = null
      yield* _(
        pipe(
          Effect.sync(() => {
            leaveTui()
          }),
          Effect.zipRight(nextInteractiveEffect),
          Effect.ensuring(
            Effect.sync(() => {
              restoreMenuAfterInteractiveEffect(store)
              leaveTui()
            })
          )
        )
      )
    }
  })

export const runMenu: Effect.Effect<void, MenuError, MenuEnv> = pipe(
  Effect.sync(() => process.stdin.isTTY && process.stdout.isTTY),
  Effect.flatMap((hasTty) => (hasTty ? runInteractiveMenu() : renderMenuProjectSummaries()))
)

export type MenuRuntimeError = MenuError
