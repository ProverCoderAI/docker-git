export interface PortRange {
  readonly min: number
  readonly max: number
}

// CHANGE: select a free port from a range
// WHY: avoid SSH port collisions across docker-git projects
// QUOTE(ТЗ): "Что не так?"
// REF: user-request-2026-01-14
// SOURCE: n/a
// FORMAT THEOREM: forall p in range: p not in used -> select(p) = p
// PURITY: CORE
// EFFECT: Effect<number | null, never, never>
// INVARIANT: result is within [min, max] or null if exhausted
// COMPLEXITY: O(n) where n = |range|
export const findAvailablePort = (
  preferred: number,
  used: ReadonlyArray<number>,
  range: PortRange
): number | null => {
  const min = Math.min(range.min, range.max)
  const max = Math.max(range.min, range.max)
  const usedSet = new Set(
    used.filter((port) => Number.isFinite(port)).map((port) => Math.trunc(port))
  )
  const normalized = Number.isFinite(preferred) ? Math.trunc(preferred) : min
  const start = normalized >= min && normalized <= max ? normalized : min

  for (let port = start; port <= max; port += 1) {
    if (!usedSet.has(port)) {
      return port
    }
  }

  for (let port = min; port < start; port += 1) {
    if (!usedSet.has(port)) {
      return port
    }
  }

  return null
}
