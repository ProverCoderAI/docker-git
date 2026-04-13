import { Effect, Match, pipe } from "effect"

import { createAuthTerminalSession, githubLogin } from "./api-client.js"
import { readAuthSnapshot, successMessage, writeAuthFlow } from "./menu-auth-data.js"
import { type MenuError, renderMenuError } from "./menu-errors.js"
import { pauseOnError, resumeSshWithSkipInputs, withSuspendedTui } from "./menu-shared.js"
import type { AuthSnapshot, MenuEnv, MenuViewContext, ViewState } from "./menu-types.js"
import { attachTerminalSession } from "./terminal-session-client.js"

type AuthPromptView = Extract<ViewState, { readonly _tag: "AuthPrompt" }>

type AuthEffectContext = MenuViewContext & {
  readonly runner: { readonly runEffect: (effect: Effect.Effect<void, MenuError, MenuEnv>) => void }
  readonly setSshActive: (active: boolean) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
  readonly cwd: string
}

const missingAuthTerminalSessionError = (provider: "ClaudeOauth" | "GeminiOauth"): MenuError => ({
  _tag: "ApiRequestError",
  method: "POST",
  path: "/auth/terminal-sessions",
  message: `Controller did not create a terminal session for ${provider}.`
})

const resolveLabelOption = (values: Readonly<Record<string, string>>): string | null => {
  const labelValue = (values["label"] ?? "").trim()
  return labelValue.length > 0 ? labelValue : null
}

const resolveTerminalAuthEffect = (
  provider: "ClaudeOauth" | "GeminiOauth",
  labelOption: string | null
): Effect.Effect<void, MenuError, MenuEnv> =>
  createAuthTerminalSession(provider, labelOption).pipe(
    Effect.flatMap((session) =>
      session === null
        ? Effect.fail(missingAuthTerminalSessionError(provider))
        : attachTerminalSession({
          header: provider === "ClaudeOauth" ? "Claude Code OAuth" : "Gemini CLI OAuth",
          session,
          websocketPath: `/auth/terminal-sessions/${encodeURIComponent(session.id)}/ws`
        })
    )
  )

export const resolveAuthPromptEffect = (
  view: AuthPromptView,
  cwd: string,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, MenuError, MenuEnv> => {
  const labelOption = resolveLabelOption(values)
  return Match.value(view.flow).pipe(
    Match.when("GithubOauth", () =>
      githubLogin({
        _tag: "AuthGithubLogin",
        label: labelOption,
        token: null,
        scopes: null,
        envGlobalPath: view.snapshot.globalEnvPath
      }).pipe(Effect.asVoid)),
    Match.when("ClaudeOauth", () => resolveTerminalAuthEffect("ClaudeOauth", labelOption)),
    Match.when("ClaudeLogout", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GeminiOauth", () => resolveTerminalAuthEffect("GeminiOauth", labelOption)),
    Match.when("GeminiApiKey", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GeminiLogout", (flow) => writeAuthFlow(cwd, flow, values)),
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
  effect: Effect.Effect<void, MenuError, MenuEnv>,
  view: AuthPromptView,
  label: string,
  context: AuthEffectContext,
  options: { readonly suspendTui: boolean }
): void => {
  const withOptionalSuspension = options.suspendTui
    ? withSuspendedTui(effect, {
      onError: pauseOnError(renderMenuError),
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
