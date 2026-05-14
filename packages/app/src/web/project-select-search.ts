export type SelectSearchAccessors<A> = {
  readonly clonedOnHostname: (item: A) => string | undefined
  readonly containerName: (item: A) => string | undefined
  readonly displayName: (item: A) => string
  readonly projectKey: (item: A) => string
  readonly repoRef: (item: A) => string
  readonly repoUrl: (item: A) => string
}

const normalizeSearchToken = (value: string): string => value.trim().toLowerCase()

const queryTerms = (query: string): ReadonlyArray<string> =>
  normalizeSearchToken(query).split(/\s+/u).filter((term) => term.length > 0)

const searchableValues = <A>(
  item: A,
  accessors: SelectSearchAccessors<A>
): ReadonlyArray<string> =>
  [
    accessors.containerName(item) ?? "",
    accessors.displayName(item),
    accessors.projectKey(item),
    accessors.repoRef(item),
    accessors.repoUrl(item),
    accessors.clonedOnHostname(item) ?? ""
  ].map((value) => value.toLowerCase())

const hasTerm = (values: ReadonlyArray<string>, term: string): boolean => values.some((value) => value.includes(term))

// CHANGE: share project search semantics between browser project pickers
// WHY: selecting by container name must behave identically across browser panels
// QUOTE(ТЗ): "Можешь добавить ещё поиск контейнеров по имени?"
// REF: user-message-2026-04-22-container-name-search
// SOURCE: n/a
// FORMAT THEOREM: forall q,x: match(q,x) iff every query term is contained in one searchable field of x
// PURITY: CORE
// EFFECT: none
// INVARIANT: empty query preserves input order and cardinality
// COMPLEXITY: O(n*m*f) where n = |items|, m = |terms|, f = searchable fields
export const filterSelectItemsByQuery = <A>(
  items: ReadonlyArray<A>,
  query: string,
  accessors: SelectSearchAccessors<A>
): ReadonlyArray<A> => {
  const terms = queryTerms(query)
  if (terms.length === 0) {
    return items
  }
  return items.filter((item) => {
    const values = searchableValues(item, accessors)
    return terms.every((term) => hasTerm(values, term))
  })
}
