import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import type { AuthGeminiLogoutCommand } from "../core/domain.js"
import type { CommandFailedError } from "../shell/errors.js"
import { geminiApiKeyPath, geminiCredentialsPath, geminiEnvFilePath, withGeminiAuth } from "./auth-gemini-helpers.js"
import type { GeminiRuntime } from "./auth-gemini-helpers.js"
import { normalizeAccountLabel } from "./auth-helpers.js"
import { autoSyncState } from "./state-repo.js"

// CHANGE: logout Gemini CLI by clearing API key and OAuth credentials for a label
// WHY: allow revoking Gemini CLI access deterministically
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiLogout(cmd) -> credentials_cleared(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: all credential files (API key and OAuth) are removed from account directory
// COMPLEXITY: O(1)
export const authGeminiLogout = (
  command: AuthGeminiLogoutCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GeminiRuntime> =>
  Effect.gen(function*(_) {
    const accountLabel = normalizeAccountLabel(command.label, "default")
    yield* _(
      withGeminiAuth(command, ({ accountPath, fs }) =>
        Effect.gen(function*(_) {
          // Clear API key
          yield* _(fs.remove(geminiApiKeyPath(accountPath), { force: true }))
          yield* _(fs.remove(geminiEnvFilePath(accountPath), { force: true }))
          // Clear OAuth credentials (entire .gemini directory)
          yield* _(fs.remove(geminiCredentialsPath(accountPath), { recursive: true, force: true }))
        }))
    )
    yield* _(autoSyncState(`chore(state): auth gemini logout ${accountLabel}`))
  }).pipe(Effect.asVoid)
