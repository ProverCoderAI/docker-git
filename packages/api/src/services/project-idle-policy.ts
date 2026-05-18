import type { ProjectRuntimeResourceProfile } from "@effect-template/lib"

export type ProjectIdlePolicyInput = {
  readonly hasActiveAgent: boolean
  readonly hasLiveInteractiveSession: boolean
  readonly lastAgentSeenAtEpochMs: number | null
  readonly lastInteractiveSeenAtEpochMs: number | null
  readonly resourceProfile: ProjectRuntimeResourceProfile
  readonly running: boolean
  readonly startedAtEpochMs: number | null
}

export type ProjectIdlePolicyConfig = {
  readonly agentIdleTimeoutMs: number
  readonly nowEpochMs: number
}

export type ProjectIdleDecision =
  | { readonly _tag: "IgnoreStopped" }
  | { readonly _tag: "KeepRunning" }
  | { readonly _tag: "RestoreNormalResources" }
  | { readonly _tag: "ThrottleInteractiveIdle" }
  | { readonly _tag: "SuspendIdle" }

const latestEpoch = (
  values: ReadonlyArray<number | null>
): number | null => {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return finite.length === 0 ? null : Math.max(...finite)
}

const hasTimedOut = (
  latestActivityEpochMs: number | null,
  config: ProjectIdlePolicyConfig
): boolean =>
  latestActivityEpochMs === null ||
  config.nowEpochMs - latestActivityEpochMs >= config.agentIdleTimeoutMs

// CHANGE: keep the auto-suspend predicate focused on agent and live-interactive activity.
// WHY: issue #306 defines useful project work as active agents, while live terminal/browser sessions must never be stopped.
// QUOTE(ТЗ): "Если открыта сессия в реальном времени то значит что работа ведётся."
// REF: issue-306
// SOURCE: n/a
// FORMAT THEOREM: active_agent ∨ live_interactive -> not SuspendIdle
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: SuspendIdle is returned only for running projects with no active agent and no live interactive session
// COMPLEXITY: O(1)
export const decideProjectIdleAction = (
  input: ProjectIdlePolicyInput,
  config: ProjectIdlePolicyConfig
): ProjectIdleDecision => {
  if (!input.running) {
    return { _tag: "IgnoreStopped" }
  }
  if (input.hasActiveAgent) {
    return input.resourceProfile === "normal"
      ? { _tag: "KeepRunning" }
      : { _tag: "RestoreNormalResources" }
  }

  const latestAgentOrStart = latestEpoch([
    input.lastAgentSeenAtEpochMs,
    input.lastInteractiveSeenAtEpochMs,
    input.startedAtEpochMs
  ])
  if (!hasTimedOut(latestAgentOrStart, config)) {
    return { _tag: "KeepRunning" }
  }
  if (input.hasLiveInteractiveSession) {
    return input.resourceProfile === "normal"
      ? { _tag: "ThrottleInteractiveIdle" }
      : { _tag: "KeepRunning" }
  }
  return { _tag: "SuspendIdle" }
}
