import type { ParseError } from "./frontend-lib/core/domain.js"

export const createParseError = (reason: string): ParseError => ({
  _tag: "InvalidOption",
  option: "create",
  reason
})
