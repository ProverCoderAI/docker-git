import { NodeContext } from "@effect/platform-node"
import { Effect, pipe } from "effect"
import { useEffect, useMemo, useRef, useState } from "react"

import { listMenuProjectItems } from "./menu-api.js"
import type { MenuError } from "./menu-errors.js"
import { renderMenuError } from "./menu-errors.js"
import type { InputStage } from "./menu-input-handler.js"
import { writeErrorAndPause } from "./menu-shared.js"
import { defaultMenuStartupSnapshot, resolveMenuStartupSnapshot } from "./menu-startup.js"
import type { MenuEnv, MenuState, ViewState } from "./menu-types.js"

export type InteractiveMenuEffect = Effect.Effect<void, never, MenuEnv>

export type QueueInteractiveEffect = (effect: InteractiveMenuEffect) => void

export type MenuSnapshot = {
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

export type MenuSnapshotStore = {
  current: MenuSnapshot
}

// CHANGE: make a fresh CLI TUI process the first user key after readiness gates
// WHY: ready/ignoreUntil already filters bootstrap noise; skipping valid input breaks menu liveness
// QUOTE(ТЗ): "Почему-то CLI TUI не работает"
// REF: issue-274
// SOURCE: n/a
// FORMAT THEOREM: forall key in ValidMenuInput: ready(menu) -> processed(key)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: initial snapshot has no synthetic skipped user inputs
// COMPLEXITY: O(1)
export const defaultMenuSnapshot = (): MenuSnapshot => ({
  activeDir: null,
  runningDockerGitContainers: 0,
  selected: 0,
  busy: false,
  message: null,
  view: { _tag: "Menu" },
  inputStage: "active",
  ready: false,
  skipInputs: 0,
  sshActive: false,
  startupLoaded: false
})

const withBusyCleanup = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  setBusy: (isBusy: boolean) => void
): Effect.Effect<A, E, R> =>
  pipe(
    effect,
    Effect.ensuring(
      Effect.sync(() => {
        setBusy(false)
      })
    )
  )

const handleMenuError = (setMessage: (message: string | null) => void) => (error: MenuError) =>
  Effect.sync(() => {
    setMessage(renderMenuError(error))
  })

const handleInteractiveMenuError = (setMessage: (message: string | null) => void) => (error: MenuError) => {
  const message = renderMenuError(error)
  return pipe(
    writeErrorAndPause(message),
    Effect.zipRight(Effect.sync(() => {
      setMessage(message)
    }))
  )
}

const useRunEffect = (
  setBusy: (isBusy: boolean) => void,
  setMessage: (message: string | null) => void
) =>
  function<E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) {
    setBusy(true)
    const onFailure = handleMenuError(setMessage)
    const program = withBusyCleanup(
      pipe(
        effect,
        Effect.matchEffect({
          onFailure,
          onSuccess: () => Effect.void
        })
      ),
      setBusy
    )
    void Effect.runPromise(Effect.provide(program, NodeContext.layer))
  }

const useRunInteractiveEffect = (
  setBusy: (isBusy: boolean) => void,
  setMessage: (message: string | null) => void,
  queueInteractiveEffect: QueueInteractiveEffect
) =>
  function<E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) {
    setBusy(true)
    const onFailure = handleInteractiveMenuError(setMessage)
    const handledEffect = pipe(
      effect,
      Effect.matchEffect({
        onFailure,
        onSuccess: () => Effect.void
      })
    )
    queueInteractiveEffect(withBusyCleanup(handledEffect, setBusy))
  }

const useRunner = (
  setBusy: (isBusy: boolean) => void,
  setMessage: (message: string | null) => void,
  queueInteractiveEffect: QueueInteractiveEffect
) => {
  const runEffect = useRunEffect(setBusy, setMessage)
  const runInteractiveEffect = useRunInteractiveEffect(setBusy, setMessage, queueInteractiveEffect)
  return useMemo(() => ({ runEffect, runInteractiveEffect }), [runEffect, runInteractiveEffect])
}

const useMountedRef = () => {
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])
  return mountedRef
}

const useSnapshotCommit = (
  store: MenuSnapshotStore,
  setSnapshot: (snapshot: MenuSnapshot) => void,
  mountedRef: { readonly current: boolean }
) =>
(update: (snapshot: MenuSnapshot) => MenuSnapshot): void => {
  const nextSnapshot = update(store.current)
  store.current = nextSnapshot
  if (mountedRef.current) {
    setSnapshot(nextSnapshot)
  }
}

const useMenuSetters = (
  store: MenuSnapshotStore,
  setSnapshot: (snapshot: MenuSnapshot) => void,
  mountedRef: { readonly current: boolean }
) => {
  const commit = useSnapshotCommit(store, setSnapshot, mountedRef)
  return useMemo(() => ({
    setActiveDir: (value: string | null) => {
      commit((snapshot) => ({ ...snapshot, activeDir: value }))
    },
    setBusy: (isBusy: boolean) => {
      commit((snapshot) => ({ ...snapshot, busy: isBusy }))
    },
    setInputStage: (value: InputStage) => {
      commit((snapshot) => ({ ...snapshot, inputStage: value }))
    },
    setMessage: (value: string | null) => {
      commit((snapshot) => ({ ...snapshot, message: value }))
    },
    setReady: (isReady: boolean) => {
      commit((snapshot) => ({ ...snapshot, ready: isReady }))
    },
    setRunningDockerGitContainers: (value: number) => {
      commit((snapshot) => ({ ...snapshot, runningDockerGitContainers: value }))
    },
    setSelected: (update: (value: number) => number) => {
      commit((snapshot) => ({ ...snapshot, selected: update(snapshot.selected) }))
    },
    setSkipInputs: (update: (value: number) => number) => {
      commit((snapshot) => ({ ...snapshot, skipInputs: update(snapshot.skipInputs) }))
    },
    setSshActive: (isActive: boolean) => {
      commit((snapshot) => ({ ...snapshot, sshActive: isActive }))
    },
    setView: (value: ViewState) => {
      commit((snapshot) => ({ ...snapshot, view: value }))
    }
  }), [commit])
}

export const useMenuState = (store: MenuSnapshotStore, queueInteractiveEffect: QueueInteractiveEffect) => {
  const [snapshot, setSnapshot] = useState(store.current)
  const mountedRef = useMountedRef()
  const setters = useMenuSetters(store, setSnapshot, mountedRef)
  const ignoreUntil = useMemo(() => Date.now() + 400, [])
  const state = useMemo<MenuState>(() => ({ cwd: process.cwd(), activeDir: snapshot.activeDir }), [snapshot.activeDir])
  const runner = useRunner(setters.setBusy, setters.setMessage, queueInteractiveEffect)
  return { ...snapshot, ...setters, ignoreUntil, state, runner }
}

export const useReadyGate = (setReady: (isReady: boolean) => void) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true)
    }, 150)
    return () => {
      clearTimeout(timer)
    }
  }, [setReady])
}

export const useStartupSnapshot = (
  store: MenuSnapshotStore,
  setActiveDir: (value: string | null) => void,
  setRunningDockerGitContainers: (value: number) => void,
  setMessage: (message: string | null) => void
) => {
  useEffect(() => {
    if (store.current.startupLoaded) {
      return
    }
    let isCancelled = false
    const startup = pipe(
      listMenuProjectItems,
      Effect.map((items) => resolveMenuStartupSnapshot(items)),
      Effect.match({
        onFailure: (error: MenuError) => ({ ...defaultMenuStartupSnapshot(), message: renderMenuError(error) }),
        onSuccess: (snapshot) => snapshot
      }),
      Effect.provide(NodeContext.layer)
    )
    const applyStartupSnapshot = (snapshot: Effect.Effect.Success<typeof startup>): void => {
      if (isCancelled) {
        return
      }
      store.current = { ...store.current, startupLoaded: true }
      setRunningDockerGitContainers(snapshot.runningDockerGitContainers)
      setMessage(snapshot.message)
      if (snapshot.activeDir !== null) {
        setActiveDir(snapshot.activeDir)
      }
    }
    void Effect.runPromise(
      pipe(
        startup,
        Effect.tap((snapshot) =>
          Effect.sync(() => {
            applyStartupSnapshot(snapshot)
          })
        )
      )
    )
    return () => {
      isCancelled = true
    }
  }, [setActiveDir, setMessage, setRunningDockerGitContainers, store])
}

export const useSigintGuard = (exit: () => void, isSshActive: boolean) => {
  useEffect(() => {
    const handleSigint = () => {
      if (!isSshActive) {
        exit()
      }
    }
    process.on("SIGINT", handleSigint)
    return () => {
      process.off("SIGINT", handleSigint)
    }
  }, [exit, isSshActive])
}
