// CHANGE: own the resolved compose resource-limit shape in the container package
// WHY: docker-compose rendering needs the resolved limit type; the backend (packages/lib) keeps the
//      CLI-option-driven resolver and re-exports this type, so there is a single source of truth here.
// QUOTE(ТЗ): "Логика контейнеров должна лежать в отдельном сабмодуле"
// REF: issue-412
// PURITY: CORE
// INVARIANT: pure data shape describing docker-compose deploy limits; no behavior, no effects
// COMPLEXITY: O(1)
export type ResolvedComposeResourceLimits = {
  readonly cpuLimit: number
  readonly ramLimit: string
  readonly swapLimit: string
}
