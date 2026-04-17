import { Effect, Match } from "effect"
import { type JSX, startTransition, useEffect, useEffectEvent, useRef, useState } from "react"

import { webPrimitives } from "../ui/primitives-web.js"
import { UiProvider } from "../ui/primitives.js"
import { loadDashboard, resolveApiBaseUrl } from "./api.js"
import { createDashboardRefreshReducer, type DashboardState } from "./app-dashboard-state.js"
import { AppReady } from "./app-ready.js"
import { ErrorScreen, LoadingScreen } from "./panels.js"
import { resolveViewportLayout, type ViewportLayout, type ViewportSize } from "./viewport-layout.js"

const refreshIntervalMs = 15_000

const resolveViewportSize = (): ViewportSize => ({
  height: typeof globalThis.innerHeight === "number" ? globalThis.innerHeight : 900,
  width: typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 1280
})

const initialDashboardState = (): DashboardState => ({
  _tag: "Loading",
  apiBaseUrl: resolveApiBaseUrl()
})

const loadDashboardState = () =>
  loadDashboard().pipe(
    Effect.match({
      onFailure: (message) => ({
        _tag: "Error" as const,
        apiBaseUrl: resolveApiBaseUrl(),
        message
      }),
      onSuccess: (dashboard) => ({
        _tag: "Ready" as const,
        dashboard,
        refreshedAtMs: Date.now()
      })
    })
  )

const isDocumentVisible = (): boolean => document.visibilityState === "visible"

const useDashboardRefreshTriggers = (refresh: () => void) => {
  const refreshWhenVisible = useEffectEvent(() => {
    if (isDocumentVisible()) {
      refresh()
    }
  })

  useEffect(() => {
    const onRefreshTrigger = () => {
      refreshWhenVisible()
    }
    globalThis.addEventListener("focus", onRefreshTrigger)
    globalThis.addEventListener("online", onRefreshTrigger)
    globalThis.addEventListener("pageshow", onRefreshTrigger)
    document.addEventListener("visibilitychange", onRefreshTrigger)
    return () => {
      globalThis.removeEventListener("focus", onRefreshTrigger)
      globalThis.removeEventListener("online", onRefreshTrigger)
      globalThis.removeEventListener("pageshow", onRefreshTrigger)
      document.removeEventListener("visibilitychange", onRefreshTrigger)
    }
  }, [refreshWhenVisible])
}

const useDashboardController = () => {
  const [state, setState] = useState<DashboardState>(initialDashboardState)
  const refreshInFlightRef = useRef(false)

  const refresh = useEffectEvent(() => {
    if (refreshInFlightRef.current) {
      return
    }
    refreshInFlightRef.current = true
    void Effect.runPromise(loadDashboardState())
      .then((nextState) => {
        startTransition(() => {
          setState(createDashboardRefreshReducer(nextState))
        })
      })
      .finally(() => {
        refreshInFlightRef.current = false
      })
  })

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, refreshIntervalMs)
    return () => {
      clearInterval(interval)
    }
  }, [])

  useDashboardRefreshTriggers(refresh)

  return { refresh, state } as const
}

const useViewportMode = () => {
  const [viewportSize, setViewportSize] = useState(resolveViewportSize)

  useEffect(() => {
    const onResize = () => {
      setViewportSize(resolveViewportSize())
    }
    globalThis.addEventListener("resize", onResize)
    return () => {
      globalThis.removeEventListener("resize", onResize)
    }
  }, [])

  return resolveViewportLayout(viewportSize)
}

const renderDashboardState = (
  state: DashboardState,
  refreshDashboard: () => void,
  viewportLayout: ViewportLayout
): JSX.Element =>
  Match.value(state).pipe(
    Match.when({ _tag: "Loading" }, ({ apiBaseUrl }) => <LoadingScreen apiBaseUrl={apiBaseUrl} />),
    Match.when(
      { _tag: "Error" },
      ({ apiBaseUrl, message }) => <ErrorScreen apiBaseUrl={apiBaseUrl} message={message} />
    ),
    Match.when(
      { _tag: "Ready" },
      ({ dashboard, refreshedAtMs }) => (
        <AppReady
          dashboard={dashboard}
          dashboardRefreshTick={refreshedAtMs}
          refreshDashboard={refreshDashboard}
          viewportLayout={viewportLayout}
        />
      )
    ),
    Match.exhaustive
  )

export const App = (): JSX.Element => {
  const { refresh, state } = useDashboardController()
  const viewport = useViewportMode()

  return (
    <div
      style={{
        backgroundColor: "#0b0d10",
        color: "#f4f7fb",
        fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
        fontSize: viewport.fontSize,
        height: "100dvh",
        inset: 0,
        overflow: "hidden",
        position: "fixed",
        width: "100%"
      }}
    >
      <UiProvider primitives={webPrimitives}>
        {renderDashboardState(state, refresh, viewport)}
      </UiProvider>
    </div>
  )
}
