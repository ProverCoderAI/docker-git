import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import type { AuthGeminiStatusCommand } from "../core/domain.js"
import type { CommandFailedError } from "../shell/errors.js"
import { resolveGeminiAuthMethod, withGeminiAuth } from "./auth-gemini-helpers.js"
import type { GeminiRuntime } from "./auth-gemini-helpers.js"

// CHANGE: show Gemini CLI auth status for a given label
// WHY: allow verifying API key/OAuth presence without exposing credentials
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiStatus(cmd) -> connected(cmd, method) | disconnected(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: never logs API keys or OAuth tokens
// COMPLEXITY: O(1)
export const authGeminiStatus = (
  command: AuthGeminiStatusCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GeminiRuntime> =>
  withGeminiAuth(command, ({ accountLabel, accountPath, fs }) =>
    Effect.gen(function*(_) {
      const authMethod = yield* _(resolveGeminiAuthMethod(fs, accountPath))
      if (authMethod === "none") {
        yield* _(Effect.log(`Gemini not connected (${accountLabel}).`))
        return
      }
      yield* _(Effect.log(`Gemini connected (${accountLabel}, ${authMethod}).`))
    }))
