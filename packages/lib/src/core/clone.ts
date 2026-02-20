export type CloneRequest =
  | { readonly _tag: "Clone"; readonly args: ReadonlyArray<string> }
  | { readonly _tag: "Open"; readonly args: ReadonlyArray<string> }
  | { readonly _tag: "None" }

const emptyRequest: CloneRequest = { _tag: "None" }

const toCloneRequest = (args: ReadonlyArray<string>): CloneRequest => ({
  _tag: "Clone",
  args
})

const toOpenRequest = (args: ReadonlyArray<string>): CloneRequest => ({
  _tag: "Open",
  args
})

const resolveLifecycleArgs = (
  argv: ReadonlyArray<string>,
  command: "clone" | "open"
): ReadonlyArray<string> => {
  if (argv.length === 0) {
    return []
  }
  const [first, ...rest] = argv
  return first === command ? rest : argv
}

// CHANGE: resolve clone/open shortcut requests from argv + npm lifecycle metadata
// WHY: support pnpm run clone/open <url> without requiring "--"
// QUOTE(ТЗ): "Добавить команду open. ... Просто открывает существующий по ссылке"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall a,e: resolve(a,e) -> deterministic
// PURITY: CORE
// EFFECT: Effect<CloneRequest, never, never>
// INVARIANT: command requested only when argv[0] or npmLifecycleEvent is clone/open
// COMPLEXITY: O(n)
export const resolveCloneRequest = (
  argv: ReadonlyArray<string>,
  npmLifecycleEvent: string | undefined
): CloneRequest => {
  if (npmLifecycleEvent === "clone") {
    return toCloneRequest(resolveLifecycleArgs(argv, "clone"))
  }

  if (npmLifecycleEvent === "open") {
    return toOpenRequest(resolveLifecycleArgs(argv, "open"))
  }

  if (argv.length > 0 && argv[0] === "clone") {
    return toCloneRequest(argv.slice(1))
  }

  if (argv.length > 0 && argv[0] === "open") {
    return toOpenRequest(argv.slice(1))
  }

  return emptyRequest
}
