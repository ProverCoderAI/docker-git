// CHANGE: share project resource limit request shapes across CLI and web clients
// WHY: one request contract prevents duplicated shell-local type drift
// QUOTE(ТЗ): "На них бы тоже действовали лимиты."
// REF: issue-306
// SOURCE: n/a
// FORMAT THEOREM: forall client in {cli, web}: request_fields(client) = request_fields(shared)
// PURITY: CORE
// EFFECT: none
// INVARIANT: CLI and web clients serialize the same project resource limit fields
// COMPLEXITY: O(1)
export type ProjectResourceLimitRequest = {
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly playwrightCpuLimit?: string | undefined
  readonly playwrightRamLimit?: string | undefined
}

export type ApplyProjectRequest = ProjectResourceLimitRequest & {
  readonly gpu?: "none" | "all" | undefined
}
