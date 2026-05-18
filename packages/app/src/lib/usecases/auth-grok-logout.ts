import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import type { AuthGrokLogoutCommand } from "../core/domain.js"
import type { CommandFailedError } from "../shell/errors.js"
import { grokApiKeyPath, grokCredentialsPath, grokEnvFilePath, withGrokAuth } from "./auth-grok-helpers.js"
import type { GrokRuntime } from "./auth-grok-helpers.js"
import { normalizeAccountLabel } from "./auth-helpers.js"
import { autoSyncState } from "./state-repo.js"

// CHANGE: logout Grok CLI by clearing API key and ~/.grok credentials for a label
// WHY: allow revoking Grok CLI access deterministically
// QUOTE(ТЗ): "Реализовать поддержку авторизации grok"
// REF: issue-304
// SOURCE: https://x.ai/news/grok-build-cli
// FORMAT THEOREM: forall cmd: authGrokLogout(cmd) -> credentials_cleared(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GrokRuntime>
// INVARIANT: all credential files are removed from account directory
// COMPLEXITY: O(1)
export const authGrokLogout = (
  command: AuthGrokLogoutCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GrokRuntime> =>
  Effect.gen(function*(_) {
    const accountLabel = normalizeAccountLabel(command.label, "default")
    yield* _(
      withGrokAuth(command, ({ accountPath, fs }) =>
        Effect.gen(function*(_) {
          yield* _(fs.remove(grokApiKeyPath(accountPath), { force: true }))
          yield* _(fs.remove(grokEnvFilePath(accountPath), { force: true }))
          yield* _(fs.remove(grokCredentialsPath(accountPath), { recursive: true, force: true }))
        }))
    )
    yield* _(autoSyncState(`chore(state): auth grok logout ${accountLabel}`))
  }).pipe(Effect.asVoid)
