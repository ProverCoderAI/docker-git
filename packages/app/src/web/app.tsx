import { Effect, Match } from "effect"
import {
  type Dispatch,
  type JSX,
  type SetStateAction,
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from "react"

import { webPrimitives } from "../ui/primitives-web.js"
import { UiProvider } from "../ui/primitives.js"
import { loadDashboard, resolveApiBaseUrl } from "./api.js"
import { createDashboardRefreshReducer, type DashboardState } from "./app-dashboard-state.js"
import { AppReady } from "./app-ready.js"
import { resolveWebAppRoute } from "./app-terminal-session-core.js"
import { ErrorScreen, LoadingScreen } from "./panels.js"
import { resolveViewportLayout, type ViewportLayout, type ViewportSize } from "./viewport-layout.js"

const refreshIntervalMs = 15_000

type OptionalVisualViewportGlobal = typeof globalThis & {
  readonly visualViewport?: VisualViewport | null
}

const readVisualViewport = (global: OptionalVisualViewportGlobal): VisualViewport | null =>
  global.visualViewport ?? null

const resolveViewportSize = (): ViewportSize => {
  const layoutHeight = typeof innerHeight === "number" ? innerHeight : 900
  const layoutWidth = typeof innerWidth === "number" ? innerWidth : 1280
  const visualViewport = readVisualViewport(globalThis)

  if (visualViewport === null) {
    return {
      height: layoutHeight,
      layoutHeight,
      layoutWidth,
      offsetLeft: 0,
      offsetTop: 0,
      width: layoutWidth
    }
  }

  return {
    height: Math.round(visualViewport.height),
    layoutHeight,
    layoutWidth,
    offsetLeft: Math.round(visualViewport.offsetLeft),
    offsetTop: Math.round(visualViewport.offsetTop),
    width: Math.round(visualViewport.width)
  }
}

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

const applyDashboardRefresh = (
  setState: Dispatch<SetStateAction<DashboardState>>,
  nextState: DashboardState
): void => {
  startTransition(() => {
    setState(createDashboardRefreshReducer(nextState))
  })
}

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
    addEventListener("focus", onRefreshTrigger)
    addEventListener("online", onRefreshTrigger)
    addEventListener("pageshow", onRefreshTrigger)
    document.addEventListener("visibilitychange", onRefreshTrigger)
    return () => {
      removeEventListener("focus", onRefreshTrigger)
      removeEventListener("online", onRefreshTrigger)
      removeEventListener("pageshow", onRefreshTrigger)
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
    const applyRefreshedState = (nextState: DashboardState) =>
      Effect.sync(() => {
        applyDashboardRefresh(setState, nextState)
      })
    const clearRefreshFlag = Effect.sync(() => {
      refreshInFlightRef.current = false
    })
    const refreshEffect = loadDashboardState().pipe(
      Effect.tap(applyRefreshedState),
      Effect.ensuring(clearRefreshFlag)
    )
    void Effect.runPromise(refreshEffect)
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

    addEventListener("resize", onResize)
    globalThis.visualViewport?.addEventListener("resize", onResize)
    globalThis.visualViewport?.addEventListener("scroll", onResize)
    return () => {
      removeEventListener("resize", onResize)
      globalThis.visualViewport?.removeEventListener("resize", onResize)
      globalThis.visualViewport?.removeEventListener("scroll", onResize)
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

const AppFrame = (
  { children, viewport }: { readonly children: JSX.Element; readonly viewport: ViewportLayout }
): JSX.Element => (
  <div
    style={{
      backgroundColor: "#0b0d10",
      color: "#f4f7fb",
      fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
      fontSize: viewport.fontSize,
      height: viewport.viewportHeight,
      minHeight: viewport.viewportHeight,
      overflow: "hidden",
      width: "100%"
    }}
  >
    <UiProvider primitives={webPrimitives}>
      {children}
    </UiProvider>
  </div>
)

const AppDashboard = ({ viewport }: { readonly viewport: ViewportLayout }): JSX.Element => {
  const { refresh, state } = useDashboardController()

  return renderDashboardState(state, refresh, viewport)
}

export const App = (): JSX.Element => {
  const viewport = useViewportMode()
  const [route] = useState(() => resolveWebAppRoute(location.pathname))

  return (
    <AppFrame viewport={viewport}>
      {Match.value(route).pipe(
        Match.when({ tag: "Dashboard" }, () => <AppDashboard viewport={viewport} />),
        Match.exhaustive
      )}
    </AppFrame>
  )
}
