type RecreatePhase = "idle" | "running" | "success" | "error"

export type RecreateStatus = {
  readonly phase: RecreatePhase
  readonly message: string
  readonly updatedAt: string
}

const nowIso = (): string => new Date().toISOString()

const defaultStatus = (): RecreateStatus => ({
  phase: "idle",
  message: "idle",
  updatedAt: nowIso()
})

const state: Map<string, RecreateStatus> = new Map()

// CHANGE: read recreate status for a project
// WHY: surface background recreate progress in the web UI
// QUOTE(ТЗ): "сделать что бы всё работало удобно"
// REF: user-request-2026-02-04-recreate-status
// SOURCE: n/a
// FORMAT THEOREM: forall p: get(p) = status(p) ∨ idle
// PURITY: SHELL
// EFFECT: Effect<RecreateStatus, never, never>
// INVARIANT: always returns a status object
// COMPLEXITY: O(1)
export const getRecreateStatus = (projectId: string): RecreateStatus =>
  state.get(projectId) ?? defaultStatus()

// CHANGE: update recreate status for a project
// WHY: keep UI state consistent with background work
// QUOTE(ТЗ): "сделать что бы всё работало удобно"
// REF: user-request-2026-02-04-recreate-status
// SOURCE: n/a
// FORMAT THEOREM: forall p,s: set(p,s) -> get(p)=s
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: updatedAt is preserved from input
// COMPLEXITY: O(1)
export const setRecreateStatus = (projectId: string, status: RecreateStatus): void => {
  state.set(projectId, status)
}

// CHANGE: build and store a recreate status update
// WHY: reduce duplication in background recreate workflow
// QUOTE(ТЗ): "сделать что бы всё работало удобно"
// REF: user-request-2026-02-04-recreate-status
// SOURCE: n/a
// FORMAT THEOREM: forall p,ph: mark(p,ph) -> get(p).phase = ph
// PURITY: SHELL
// EFFECT: Effect<RecreateStatus, never, never>
// INVARIANT: updatedAt always increases monotonically per project
// COMPLEXITY: O(1)
export const markRecreateStatus = (
  projectId: string,
  phase: RecreatePhase,
  message: string
): RecreateStatus => {
  const status = {
    phase,
    message,
    updatedAt: nowIso()
  }
  setRecreateStatus(projectId, status)
  return status
}
