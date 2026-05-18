import type { PlatformError } from "@effect/platform/Error"
import { Effect, Match } from "effect"

import type { AuthGrokStatusCommand } from "../core/domain.js"
import type { CommandFailedError } from "../shell/errors.js"
import { resolveGrokAuthMethod, withGrokAuth } from "./auth-grok-helpers.js"
import type { GrokRuntime } from "./auth-grok-helpers.js"

// CHANGE: show Grok CLI auth status for a given label
// WHY: allow verifying API-key/user-settings presence without exposing credentials
// QUOTE(ТЗ): "Реализовать поддержку авторизации grok"
// REF: issue-304
// SOURCE: https://x.ai/news/grok-build-cli
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
      yield* _(
        Match.value(authMethod).pipe(
          Match.when("none", () => Effect.log(`Grok not connected (${accountLabel}).`)),
          Match.when("api-key", () => Effect.log(`Grok connected (${accountLabel}, api-key).`)),
          Match.when("oauth", () => Effect.log(`Grok connected (${accountLabel}, oauth).`)),
          Match.exhaustive
        )
      )
    }))
