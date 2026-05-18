import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"
import type { AuthGeminiLoginCommand } from "../core/domain.js"
import type { AuthError, CommandFailedError } from "../shell/errors.js"
import {
  defaultGeminiSettings,
  geminiApiKeyPath,
  geminiContainerHomeDir,
  geminiCredentialsPath,
  geminiImageName,
  type GeminiRuntime,
  prepareGeminiCredentialsDir,
  withGeminiAuth,
  writeInitialSettings
} from "./auth-gemini-helpers.js"
import { runGeminiOauthLoginWithPrompt } from "./auth-gemini-oauth.js"
import { normalizeAccountLabel } from "./auth-helpers.js"
import { autoSyncState } from "./state-repo.js"

// CHANGE: login to Gemini CLI by storing API key (menu version with direct key)
// WHY: Gemini CLI uses GEMINI_API_KEY environment variable for authentication
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiLogin(cmd) -> api_key_file_exists(accountPath)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: API key is stored in .api-key file with 0600 permissions
// COMPLEXITY: O(1)
export const authGeminiLogin = (
  command: AuthGeminiLoginCommand,
  apiKey: string
): Effect.Effect<void, PlatformError | CommandFailedError, GeminiRuntime> => {
  const accountLabel = normalizeAccountLabel(command.label, "default")
  return withGeminiAuth(command, ({ accountPath, fs }) =>
    Effect.gen(function*(_) {
      const apiKeyFilePath = geminiApiKeyPath(accountPath)
      yield* _(fs.writeFileString(apiKeyFilePath, `${apiKey.trim()}\n`))
      yield* _(fs.chmod(apiKeyFilePath, 0o600), Effect.orElseSucceed(() => void 0))

      const credentialsDir = geminiCredentialsPath(accountPath)
      yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
      const settingsPath = `${credentialsDir}/settings.json`
      yield* _(
        fs.writeFileString(
          settingsPath,
          JSON.stringify(defaultGeminiSettings, null, 2) + "\n"
        )
      )
    })).pipe(
      Effect.zipRight(autoSyncState(`chore(state): auth gemini ${accountLabel}`))
    )
}

// CHANGE: login to Gemini CLI via CLI (prompts user to run web-based setup)
// WHY: CLI-based login requires interactive API key entry
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiLoginCli(cmd) -> instruction_shown
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: only shows instructions, does not store credentials
// COMPLEXITY: O(1)
export const authGeminiLoginCli = (
  _command: AuthGeminiLoginCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GeminiRuntime> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log("Gemini CLI supports two authentication methods:"))
    yield* _(Effect.log(""))
    yield* _(Effect.log("1. API Key (recommended for simplicity):"))
    yield* _(Effect.log("   - Go to https://ai.google.dev/aistudio"))
    yield* _(Effect.log("   - Create or retrieve your API key"))
    yield* _(Effect.log("   - Use: docker-git menu -> Auth profiles -> Gemini CLI: set API key"))
    yield* _(Effect.log(""))
    yield* _(Effect.log("2. OAuth (Sign in with Google):"))
    yield* _(Effect.log("   - Use: docker-git menu -> Auth profiles -> Gemini CLI: login via OAuth"))
    yield* _(Effect.log("   - Follow the prompts to authenticate with your Google account"))
  })

// FORMAT THEOREM: forall cmd: authGeminiLoginOauth(cmd) -> oauth_credentials_stored | error
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: OAuth credentials are stored in account directory after successful auth
// COMPLEXITY: O(user_interaction)
export const authGeminiLoginOauth = (
  command: AuthGeminiLoginCommand
): Effect.Effect<void, AuthError | PlatformError | CommandFailedError, GeminiRuntime> => {
  const accountLabel = normalizeAccountLabel(command.label, "default")
  return withGeminiAuth(
    command,
    ({ accountPath, cwd, fs }) =>
      Effect.gen(function*(_) {
        const credentialsDir = yield* _(prepareGeminiCredentialsDir(cwd, accountPath, fs))
        const settingsPath = yield* _(writeInitialSettings(credentialsDir, fs))

        yield* _(
          runGeminiOauthLoginWithPrompt(cwd, accountPath, {
            image: geminiImageName,
            containerPath: geminiContainerHomeDir
          })
        )

        // Generate complete settings.json on the host so containers don't have to guess
        yield* _(
          fs.writeFileString(
            settingsPath,
            JSON.stringify(defaultGeminiSettings, null, 2) + "\n"
          )
        )
      }),
    { buildImage: true }
  ).pipe(
    Effect.zipRight(autoSyncState(`chore(state): auth gemini oauth ${accountLabel}`))
  )
}

export { authGeminiLogout } from "./auth-gemini-logout.js"
export { authGeminiStatus } from "./auth-gemini-status.js"
