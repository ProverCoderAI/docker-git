import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import type { AuthGrokStatusCommand } from "../core/domain.js"
import type { CommandFailedError } from "../shell/errors.js"
import { resolveGrokAuthMethod, withGrokAuth } from "./auth-grok-helpers.js"
import type { GrokRuntime } from "./auth-grok-helpers.js"

// CHANGE: show Grok CLI auth status for a given label
// WHY: allow verifying API-key/user-settings presence without exposing credentials
// QUOTE(ТЗ): "Реализовать поддержку авторизации grok"
// REF: issue-304
// SOURCE: https://www.npmjs.com/package/grok-dev
// FORMAT THEOREM: forall cmd: authGrokStatus(cmd) -> connected(cmd, method) | disconnected(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GrokRuntime>
// INVARIANT: never logs API keys or tokens
// COMPLEXITY: O(1)
export const authGrokStatus = (
  command: AuthGrokStatusCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GrokRuntime> =>
  withGrokAuth(command, ({ accountLabel, accountPath, fs }) =>
    Effect.gen(function*(_) {
      const authMethod = yield* _(resolveGrokAuthMethod(fs, accountPath))
      if (authMethod === "none") {
        yield* _(Effect.log(`Grok not connected (${accountLabel}).`))
        return
      }
      yield* _(Effect.log(`Grok connected (${accountLabel}, ${authMethod}).`))
    }))
