import type { DashboardData } from "./api.js"

export type DashboardState =
  | { readonly _tag: "Loading"; readonly apiBaseUrl: string }
  | { readonly _tag: "Error"; readonly apiBaseUrl: string; readonly message: string }
  | { readonly _tag: "Ready"; readonly dashboard: DashboardData; readonly refreshedAtMs: number }

export const mergeDashboardRefreshState = (
  current: DashboardState,
  next: DashboardState
): DashboardState =>
  next._tag === "Error" && current._tag === "Ready"
    ? current
    : next

export const createDashboardRefreshReducer =
  (next: DashboardState) =>
  (current: DashboardState): DashboardState =>
    mergeDashboardRefreshState(current, next)
