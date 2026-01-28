export type CloneRequest =
  | { readonly _tag: "Clone"; readonly args: ReadonlyArray<string> }
  | { readonly _tag: "None" }

const emptyRequest: CloneRequest = { _tag: "None" }

const toCloneRequest = (args: ReadonlyArray<string>): CloneRequest => ({
  _tag: "Clone",
  args
})

// CHANGE: resolve a clone request from argv + npm lifecycle metadata
// WHY: support pnpm run clone <url> without requiring "--"
// QUOTE(ТЗ): "pnpm run clone <url>"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall a,e: resolve(a,e) -> deterministic
// PURITY: CORE
// EFFECT: Effect<CloneRequest, never, never>
// INVARIANT: clone requested only when argv[0] == "clone" or npmLifecycleEvent == "clone"
// COMPLEXITY: O(n)
export const resolveCloneRequest = (
  argv: ReadonlyArray<string>,
  npmLifecycleEvent: string | undefined
): CloneRequest => {
  if (npmLifecycleEvent === "clone") {
    if (argv.length > 0) {
      const [first, ...rest] = argv
      return first === "clone" ? toCloneRequest(rest) : toCloneRequest(argv)
    }

    return toCloneRequest([])
  }

  if (argv.length > 0 && argv[0] === "clone") {
    return toCloneRequest(argv.slice(1))
  }

  return emptyRequest
}
