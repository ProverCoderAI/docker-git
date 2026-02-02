import { Match } from "effect"

import type { ParseError } from "./domain.js"

// CHANGE: normalize parse errors into deterministic messages
// WHY: reuse parse error formatting across CLI and server flows
// QUOTE(ТЗ): "ошибки должны быть описывающими"
// REF: user-request-2026-02-02-cli-split
// SOURCE: n/a
// FORMAT THEOREM: forall e: format(e) = s -> deterministic(s)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: each ParseError maps to exactly one message
// COMPLEXITY: O(1)
export const formatParseError = (error: ParseError): string =>
  Match.value(error).pipe(
    Match.when({ _tag: "UnknownCommand" }, ({ command }) => `Unknown command: ${command}`),
    Match.when({ _tag: "UnknownOption" }, ({ option }) => `Unknown option: ${option}`),
    Match.when({ _tag: "MissingOptionValue" }, ({ option }) => `Missing value for option: ${option}`),
    Match.when({ _tag: "MissingRequiredOption" }, ({ option }) => `Missing required option: ${option}`),
    Match.when({ _tag: "InvalidOption" }, ({ option, reason }) => `Invalid option ${option}: ${reason}`),
    Match.when({ _tag: "UnexpectedArgument" }, ({ value }) => `Unexpected argument: ${value}`),
    Match.exhaustive
  )
