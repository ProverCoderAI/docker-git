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

export const defaultMenuSnapshot = (): MenuSnapshot => ({
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

const withBusyCleanup = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  setBusy: (busy: boolean) => void
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
  setBusy: (busy: boolean) => void,
  setMessage: (message: string | null) => void
) =>
  function<E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) {
    setBusy(true)
    const program = withBusyCleanup(
      pipe(
        effect,
        Effect.matchEffect({
          onFailure: handleMenuError(setMessage),
          onSuccess: () => Effect.void
        })
      ),
      setBusy
    )
    void Effect.runPromise(Effect.provide(program, NodeContext.layer))
  }

const useRunInteractiveEffect = (
  setBusy: (busy: boolean) => void,
  setMessage: (message: string | null) => void,
  queueInteractiveEffect: QueueInteractiveEffect
) =>
  function<E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) {
    setBusy(true)
    queueInteractiveEffect(
      withBusyCleanup(
        pipe(
          effect,
          Effect.matchEffect({
            onFailure: handleInteractiveMenuError(setMessage),
            onSuccess: () => Effect.void
          })
        ),
        setBusy
      )
    )
  }

const useRunner = (
  setBusy: (busy: boolean) => void,
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
    setBusy: (value: boolean) => {
      commit((snapshot) => ({ ...snapshot, busy: value }))
    },
    setInputStage: (value: InputStage) => {
      commit((snapshot) => ({ ...snapshot, inputStage: value }))
    },
    setMessage: (value: string | null) => {
      commit((snapshot) => ({ ...snapshot, message: value }))
    },
    setReady: (value: boolean) => {
      commit((snapshot) => ({ ...snapshot, ready: value }))
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
    setSshActive: (value: boolean) => {
      commit((snapshot) => ({ ...snapshot, sshActive: value }))
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

export const useReadyGate = (setReady: (ready: boolean) => void) => {
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
    let cancelled = false
    const startup = pipe(
      listMenuProjectItems,
      Effect.map((items) => resolveMenuStartupSnapshot(items)),
      Effect.match({
        onFailure: (error: MenuError) => ({ ...defaultMenuStartupSnapshot(), message: renderMenuError(error) }),
        onSuccess: (snapshot) => snapshot
      }),
      Effect.provide(NodeContext.layer)
    )
    void Effect.runPromise(startup).then((snapshot) => {
      if (cancelled) {
        return
      }
      store.current = { ...store.current, startupLoaded: true }
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

export const useSigintGuard = (exit: () => void, sshActive: boolean) => {
  useEffect(() => {
    const handleSigint = () => {
      if (!sshActive) {
        exit()
      }
    }
    process.on("SIGINT", handleSigint)
    return () => {
      process.off("SIGINT", handleSigint)
    }
  }, [exit, sshActive])
}
