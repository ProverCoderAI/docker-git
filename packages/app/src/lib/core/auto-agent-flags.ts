import { Either } from "effect"

import type { RawOptions } from "./command-options.js"
import type { AgentMode, ParseError } from "./domain.js"

export const resolveAutoAgentFlags = (
  raw: RawOptions
): Either.Either<{ readonly agentMode: AgentMode | undefined; readonly agentAuto: boolean }, ParseError> => {
  const requested = raw.agentAutoMode
  if (requested === undefined) {
    return Either.right({ agentMode: undefined, agentAuto: false })
  }
  if (requested === "auto") {
    return Either.right({ agentMode: undefined, agentAuto: true })
  }
  if (requested === "claude" || requested === "codex") {
    return Either.right({ agentMode: requested, agentAuto: true })
  }
  return Either.left({
    _tag: "InvalidOption",
    option: "--auto",
    reason: "expected one of: claude, codex"
  })
}
