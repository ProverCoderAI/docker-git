import { Either } from "effect"

export type MenuAction =
  | { readonly _tag: "Create" }
  | { readonly _tag: "Select" }
  | { readonly _tag: "Info" }
  | { readonly _tag: "Up" }
  | { readonly _tag: "Status" }
  | { readonly _tag: "Logs" }
  | { readonly _tag: "Down" }
  | { readonly _tag: "Quit" }

export type ParseError =
  | { readonly _tag: "UnknownCommand"; readonly command: string }
  | { readonly _tag: "UnknownOption"; readonly option: string }
  | { readonly _tag: "MissingOptionValue"; readonly option: string }
  | { readonly _tag: "MissingRequiredOption"; readonly option: string }
  | { readonly _tag: "InvalidOption"; readonly option: string; readonly reason: string }
  | { readonly _tag: "UnexpectedArgument"; readonly value: string }

const normalizeMenuInput = (input: string): string => input.trim().toLowerCase()

const menuAliasMap = new Map<string, MenuAction>([
  ["1", { _tag: "Create" }],
  ["create", { _tag: "Create" }],
  ["c", { _tag: "Create" }],
  ["2", { _tag: "Select" }],
  ["select", { _tag: "Select" }],
  ["s", { _tag: "Select" }],
  ["3", { _tag: "Info" }],
  ["info", { _tag: "Info" }],
  ["i", { _tag: "Info" }],
  ["4", { _tag: "Up" }],
  ["up", { _tag: "Up" }],
  ["u", { _tag: "Up" }],
  ["start", { _tag: "Up" }],
  ["5", { _tag: "Status" }],
  ["status", { _tag: "Status" }],
  ["ps", { _tag: "Status" }],
  ["6", { _tag: "Logs" }],
  ["logs", { _tag: "Logs" }],
  ["log", { _tag: "Logs" }],
  ["l", { _tag: "Logs" }],
  ["7", { _tag: "Down" }],
  ["down", { _tag: "Down" }],
  ["stop", { _tag: "Down" }],
  ["d", { _tag: "Down" }],
  ["0", { _tag: "Quit" }],
  ["quit", { _tag: "Quit" }],
  ["q", { _tag: "Quit" }],
  ["exit", { _tag: "Quit" }]
])

const resolveMenuAction = (normalized: string): MenuAction | undefined => menuAliasMap.get(normalized)

// CHANGE: decode interactive menu input into a typed action
// WHY: keep menu parsing pure and reusable across shells
// QUOTE(ТЗ): "Хочу что бы открылось менюшка"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall s: parseMenu(s) = a -> deterministic(a)
// PURITY: CORE
// EFFECT: Effect<MenuAction, ParseError, never>
// INVARIANT: unknown input maps to InvalidOption
// COMPLEXITY: O(1)
export const parseMenuSelection = (input: string): Either.Either<MenuAction, ParseError> => {
  const normalized = normalizeMenuInput(input)

  if (normalized.length === 0) {
    return Either.left({
      _tag: "InvalidOption",
      option: "menu",
      reason: "empty selection"
    })
  }

  const action = resolveMenuAction(normalized)
  if (action === undefined) {
    return Either.left({
      _tag: "InvalidOption",
      option: "menu",
      reason: `unknown selection: ${input}`
    })
  }

  return Either.right(action)
}
