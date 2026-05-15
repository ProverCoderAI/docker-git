import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import type { AuthGrokLoginCommand } from "../core/domain.js"
import type { AuthError, CommandFailedError } from "../shell/errors.js"
import {
  grokApiKeyPath,
  grokContainerHomeDir,
  grokCredentialsPath,
  grokImageName,
  type GrokRuntime,
  prepareGrokCredentialsDir,
  withGrokAuth,
  writeInitialGrokSettings
} from "./auth-grok-helpers.js"
import { runGrokOauthLoginWithPrompt } from "./auth-grok-oauth.js"
import { normalizeAccountLabel } from "./auth-helpers.js"
import { autoSyncState } from "./state-repo.js"

// CHANGE: login to Grok CLI by storing API key and Grok user settings
// WHY: Grok CLI supports GROK_API_KEY/user-settings based auth while OAuth is handled by the terminal runner
// QUOTE(ТЗ): "Реализовать поддержку авторизации grok"
// REF: issue-304
// SOURCE: https://www.npmjs.com/package/grok-dev
// FORMAT THEOREM: forall cmd: authGrokLogin(cmd) -> api_key_file_exists(accountPath)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GrokRuntime>
// INVARIANT: API key is stored in .api-key and mirrored into .grok/user-settings.json
// COMPLEXITY: O(1)
export const authGrokLogin = (
  command: AuthGrokLoginCommand,
  apiKey: string
): Effect.Effect<void, PlatformError | CommandFailedError, GrokRuntime> => {
  const accountLabel = normalizeAccountLabel(command.label, "default")
  return withGrokAuth(command, ({ accountPath, fs }) =>
    Effect.gen(function*(_) {
      const trimmedApiKey = apiKey.trim()
      const apiKeyFilePath = grokApiKeyPath(accountPath)
      yield* _(fs.writeFileString(apiKeyFilePath, `${trimmedApiKey}\n`))
      yield* _(fs.chmod(apiKeyFilePath, 0o600), Effect.orElseSucceed(() => void 0))

      const credentialsDir = grokCredentialsPath(accountPath)
      yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
      yield* _(writeInitialGrokSettings(credentialsDir, fs, trimmedApiKey))
    })).pipe(
      Effect.zipRight(autoSyncState(`chore(state): auth grok ${accountLabel}`))
    )
}

export const authGrokLoginCli = (
  _command: AuthGrokLoginCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GrokRuntime> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log("Grok CLI supports two authentication methods:"))
    yield* _(Effect.log(""))
    yield* _(Effect.log("1. API Key:"))
    yield* _(Effect.log("   - Use: docker-git menu -> Auth profiles -> Grok CLI: set API key"))
    yield* _(Effect.log(""))
    yield* _(Effect.log("2. OAuth/browser login:"))
    yield* _(Effect.log("   - Use: docker-git menu -> Auth profiles -> Grok CLI: login via OAuth"))
    yield* _(Effect.log("   - Follow the Grok CLI prompts and paste the callback URL when requested"))
  })

// FORMAT THEOREM: forall cmd: authGrokLoginOauth(cmd) -> grok_credentials_stored | error
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | PlatformError | CommandFailedError, GrokRuntime>
// INVARIANT: Grok CLI writes credentials under .grok within the selected account directory
// COMPLEXITY: O(user_interaction)
export const authGrokLoginOauth = (
  command: AuthGrokLoginCommand
): Effect.Effect<void, AuthError | PlatformError | CommandFailedError, GrokRuntime> => {
  const accountLabel = normalizeAccountLabel(command.label, "default")
  return withGrokAuth(
    command,
    ({ accountPath, cwd, fs }) =>
      Effect.gen(function*(_) {
        const credentialsDir = yield* _(prepareGrokCredentialsDir(cwd, accountPath, fs))
        yield* _(writeInitialGrokSettings(credentialsDir, fs, null))

        yield* _(
          runGrokOauthLoginWithPrompt(cwd, accountPath, {
            image: grokImageName,
            containerPath: grokContainerHomeDir
          })
        )
      }),
    { buildImage: true }
  ).pipe(
    Effect.zipRight(autoSyncState(`chore(state): auth grok oauth ${accountLabel}`))
  )
}

export { authGrokLogout } from "./auth-grok-logout.js"
export { authGrokStatus } from "./auth-grok-status.js"
