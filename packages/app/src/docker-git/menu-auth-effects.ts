import { Effect, Match, pipe } from "effect"

import {
  authClaudeLogin,
  authClaudeLogout,
  authGeminiLogin,
  authGeminiLoginOauth,
  authGeminiLogout,
  authGithubLogin,
  claudeAuthRoot
} from "@effect-template/lib/usecases/auth"
import { geminiAuthRoot } from "@effect-template/lib/usecases/auth-gemini-helpers"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { renderError } from "@effect-template/lib/usecases/errors"

import { readAuthSnapshot, successMessage, writeAuthFlow } from "./menu-auth-data.js"
import { pauseOnError, resumeSshWithSkipInputs, withSuspendedTui } from "./menu-shared.js"
import type { AuthSnapshot, MenuEnv, MenuViewContext, ViewState } from "./menu-types.js"

type AuthPromptView = Extract<ViewState, { readonly _tag: "AuthPrompt" }>

type AuthEffectContext = MenuViewContext & {
  readonly runner: { readonly runEffect: (effect: Effect.Effect<void, AppError, MenuEnv>) => void }
  readonly setSshActive: (active: boolean) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
  readonly cwd: string
}

const resolveLabelOption = (values: Readonly<Record<string, string>>): string | null => {
  const labelValue = (values["label"] ?? "").trim()
  return labelValue.length > 0 ? labelValue : null
}

const resolveGithubOauthEffect = (labelOption: string | null, globalEnvPath: string) =>
  authGithubLogin({
    _tag: "AuthGithubLogin",
    label: labelOption,
    token: null,
    scopes: null,
    envGlobalPath: globalEnvPath
  })

const resolveClaudeOauthEffect = (labelOption: string | null) =>
  authClaudeLogin({ _tag: "AuthClaudeLogin", label: labelOption, claudeAuthPath: claudeAuthRoot })

const resolveClaudeLogoutEffect = (labelOption: string | null) =>
  authClaudeLogout({ _tag: "AuthClaudeLogout", label: labelOption, claudeAuthPath: claudeAuthRoot })

const resolveGeminiOauthEffect = (labelOption: string | null) =>
  authGeminiLoginOauth({ _tag: "AuthGeminiLogin", label: labelOption, geminiAuthPath: geminiAuthRoot, isWeb: false })

const resolveGeminiApiKeyEffect = (labelOption: string | null, apiKey: string) =>
  authGeminiLogin({ _tag: "AuthGeminiLogin", label: labelOption, geminiAuthPath: geminiAuthRoot, isWeb: false }, apiKey)

const resolveGeminiLogoutEffect = (labelOption: string | null) =>
  authGeminiLogout({ _tag: "AuthGeminiLogout", label: labelOption, geminiAuthPath: geminiAuthRoot })

export const resolveAuthPromptEffect = (
  view: AuthPromptView,
  cwd: string,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, AppError, MenuEnv> => {
  const labelOption = resolveLabelOption(values)
  return Match.value(view.flow).pipe(
    Match.when("GithubOauth", () => resolveGithubOauthEffect(labelOption, view.snapshot.globalEnvPath)),
    Match.when("ClaudeOauth", () => resolveClaudeOauthEffect(labelOption)),
    Match.when("ClaudeLogout", () => resolveClaudeLogoutEffect(labelOption)),
    Match.when("GeminiOauth", () => resolveGeminiOauthEffect(labelOption)),
    Match.when("GeminiApiKey", () => resolveGeminiApiKeyEffect(labelOption, (values["apiKey"] ?? "").trim())),
    Match.when("GeminiLogout", () => resolveGeminiLogoutEffect(labelOption)),
    Match.when("GithubRemove", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GitSet", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GitRemove", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.exhaustive
  )
}

export const startAuthMenuWithSnapshot = (
  snapshot: AuthSnapshot,
  context: Pick<MenuViewContext, "setView" | "setMessage">
): void => {
  context.setView({ _tag: "AuthMenu", selected: 0, snapshot })
  context.setMessage(null)
}

export const runAuthPromptEffect = (
  effect: Effect.Effect<void, AppError, MenuEnv>,
  view: AuthPromptView,
  label: string,
  context: AuthEffectContext,
  options: { readonly suspendTui: boolean }
): void => {
  const withOptionalSuspension = options.suspendTui
    ? withSuspendedTui(effect, {
      onError: pauseOnError(renderError),
      onResume: resumeSshWithSkipInputs(context)
    })
    : effect

  context.setSshActive(options.suspendTui)
  context.runner.runEffect(
    pipe(
      withOptionalSuspension,
      Effect.zipRight(readAuthSnapshot(context.cwd)),
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          startAuthMenuWithSnapshot(snapshot, context)
          context.setMessage(successMessage(view.flow, label))
        })
      ),
      Effect.asVoid
    )
  )
}
