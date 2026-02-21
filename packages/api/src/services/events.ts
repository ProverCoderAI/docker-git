import type { ApiEvent, ApiEventType } from "../api/contracts.js"

type ProjectEventsState = {
  nextSeq: number
  events: Array<ApiEvent>
}

const maxEventsPerProject = 4000
const state: Map<string, ProjectEventsState> = new Map()

const nowIso = (): string => new Date().toISOString()

const getProjectState = (projectId: string): ProjectEventsState => {
  const existing = state.get(projectId)
  if (existing) {
    return existing
  }
  const created: ProjectEventsState = {
    nextSeq: 1,
    events: []
  }
  state.set(projectId, created)
  return created
}

const trimEvents = (events: Array<ApiEvent>): Array<ApiEvent> =>
  events.length <= maxEventsPerProject
    ? events
    : events.slice(events.length - maxEventsPerProject)

// CHANGE: append a project-scoped API event for SSE consumers.
// WHY: keep realtime streams deterministic across deployment and agent lifecycles.
// QUOTE(ТЗ): "Мне надо иметь возможность управлять полностью проектом с помощью API"
// REF: issue-84-events
// SOURCE: n/a
// FORMAT THEOREM: forall p,e: emit(p,e) -> exists(event in stream(p), event.type=e)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: sequence numbers are strictly monotonic per project
// COMPLEXITY: O(1)
export const emitProjectEvent = (
  projectId: string,
  type: ApiEventType,
  payload: unknown
): ApiEvent => {
  const project = getProjectState(projectId)
  const event: ApiEvent = {
    seq: project.nextSeq,
    projectId,
    type,
    at: nowIso(),
    payload
  }
  project.nextSeq += 1
  project.events = trimEvents([...project.events, event])
  return event
}

export const listProjectEventsSince = (
  projectId: string,
  cursor: number
): ReadonlyArray<ApiEvent> => {
  const project = getProjectState(projectId)
  return project.events.filter((event) => event.seq > cursor)
}

export const latestProjectCursor = (projectId: string): number => {
  const project = getProjectState(projectId)
  const last = project.events[project.events.length - 1]
  return last ? last.seq : 0
}

export const clearProjectEvents = (projectId: string): void => {
  state.delete(projectId)
}
