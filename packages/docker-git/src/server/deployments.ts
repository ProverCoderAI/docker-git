import { Effect } from "effect"

export type DeploymentPhase = "idle" | "down" | "build" | "up" | "running" | "error"

export interface DeploymentStatus {
  readonly projectId: string
  readonly phase: DeploymentPhase
  readonly message: string
  readonly updatedAt: string
}

export interface DeploymentLogEntry {
  readonly projectId: string
  readonly line: string
  readonly timestamp: string
}

const nowIso = (): string => new Date().toISOString()

const makeDefaultStatus = (projectId: string): DeploymentStatus => ({
  projectId,
  phase: "idle",
  message: "",
  updatedAt: nowIso()
})

const state = new Map<string, DeploymentStatus>()
const logs = new Map<string, Array<DeploymentLogEntry>>()
const active = new Set<string>()
const maxLogEntries = 400

// CHANGE: read deployment status for a project
// WHY: expose current deploy phase to the UI
// QUOTE(ТЗ): "процесс деплоя отображать"
// REF: user-request-2026-01-13
// SOURCE: n/a
// FORMAT THEOREM: forall id: status(id) -> DeploymentStatus(id)
// PURITY: SHELL
// EFFECT: Effect<DeploymentStatus, never, never>
// INVARIANT: returns a status even if none exists
// COMPLEXITY: O(1)
export const getDeploymentStatus = (
  projectId: string
): Effect.Effect<DeploymentStatus, never, never> =>
  Effect.sync(() => state.get(projectId) ?? makeDefaultStatus(projectId))

// CHANGE: list all deployment statuses
// WHY: enable dashboard polling without per-project calls
// QUOTE(ТЗ): "на фронте показывать что конейтер ещё не запущен"
// REF: user-request-2026-01-13
// SOURCE: n/a
// FORMAT THEOREM: forall _: list() -> statuses
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<DeploymentStatus>, never, never>
// INVARIANT: order follows insertion order
// COMPLEXITY: O(n) where n = |statuses|
export const listDeploymentStatuses = (): Effect.Effect<ReadonlyArray<DeploymentStatus>, never, never> =>
  Effect.sync(() => Array.from(state.values()))

// CHANGE: append a deployment log line
// WHY: persist build output for troubleshooting long installs
// QUOTE(ТЗ): "лог установки зависимостей выводить"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall id: append(id) -> log_length(id) <= max
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<DeploymentLogEntry>, never, never>
// INVARIANT: log lines are capped
// COMPLEXITY: O(1)
export const appendDeploymentLog = (
  projectId: string,
  line: string
): Effect.Effect<ReadonlyArray<DeploymentLogEntry>, never, never> =>
  Effect.sync(() => {
    const entry: DeploymentLogEntry = {
      projectId,
      line,
      timestamp: nowIso()
    }
    const existing = logs.get(projectId) ?? []
    const next = [...existing, entry]
    const trimmed = next.length > maxLogEntries ? next.slice(next.length - maxLogEntries) : next
    logs.set(projectId, trimmed)
    return trimmed
  })

// CHANGE: clear deployment logs for a project
// WHY: separate runs for clarity
// QUOTE(ТЗ): "лог установки зависимостей выводить"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall id: clear(id) -> log_length(id) = 0
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: log array exists after clear
// COMPLEXITY: O(1)
export const clearDeploymentLogs = (
  projectId: string
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    logs.set(projectId, [])
  })

// CHANGE: list deployment logs for a project
// WHY: show build output in the UI
// QUOTE(ТЗ): "лог установки зависимостей выводить"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall id: list(id) -> logs(id)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<DeploymentLogEntry>, never, never>
// INVARIANT: returns an empty list if none
// COMPLEXITY: O(1)
export const listDeploymentLogs = (
  projectId: string
): Effect.Effect<ReadonlyArray<DeploymentLogEntry>, never, never> =>
  Effect.sync(() => logs.get(projectId) ?? [])

// CHANGE: mark deployment as active
// WHY: avoid orphaned in-progress status when HTTP requests are cancelled
// QUOTE(ТЗ): "Он вообще виснет как я понимаю"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall id: active(id) -> activeSet contains id
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: active set contains projectId
// COMPLEXITY: O(1)
export const markDeploymentActive = (
  projectId: string
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    active.add(projectId)
  })

// CHANGE: mark deployment as inactive
// WHY: ensure status can recover after completion or interruption
// QUOTE(ТЗ): "Он вообще виснет как я понимаю"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall id: inactive(id) -> activeSet excludes id
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: active set excludes projectId
// COMPLEXITY: O(1)
export const markDeploymentInactive = (
  projectId: string
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    active.delete(projectId)
  })

// CHANGE: check whether a deployment is active
// WHY: avoid overlapping docker compose actions
// QUOTE(ТЗ): "Он вообще виснет как я понимаю"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall id: isActive(id) -> boolean
// PURITY: SHELL
// EFFECT: Effect<boolean, never, never>
// INVARIANT: reflects active set membership
// COMPLEXITY: O(1)
export const isDeploymentActive = (
  projectId: string
): Effect.Effect<boolean, never, never> =>
  Effect.sync(() => active.has(projectId))

// CHANGE: upsert deployment status for a project
// WHY: track deploy phases across docker compose operations
// QUOTE(ТЗ): "Он запускается ТАкая-то стадия"
// REF: user-request-2026-01-13
// SOURCE: n/a
// FORMAT THEOREM: forall id,phase: set(id, phase) -> status(id).phase = phase
// PURITY: SHELL
// EFFECT: Effect<DeploymentStatus, never, never>
// INVARIANT: updatedAt is ISO timestamp
// COMPLEXITY: O(1)
export const setDeploymentStatus = (
  projectId: string,
  phase: DeploymentPhase,
  message: string
): Effect.Effect<DeploymentStatus, never, never> =>
  Effect.sync(() => {
    const next: DeploymentStatus = {
      projectId,
      phase,
      message,
      updatedAt: nowIso()
    }
    state.set(projectId, next)
    return next
  })
