import { Effect, Match, pipe } from "effect"

import { codexLogin, codexLogout, createAuthTerminalSession, githubLogin } from "./api-client.js"
import { readAuthSnapshot, successMessage, writeAuthFlow } from "./menu-auth-data.js"
import { terminalAuthTitle } from "./menu-auth-shared.js"
import type { MenuError } from "./menu-errors.js"
import type { AuthSnapshot, MenuEnv, MenuRunner, MenuViewContext, ViewState } from "./menu-types.js"
import { attachTerminalSession } from "./terminal-session-client.js"

type AuthPromptView = Extract<ViewState, { readonly _tag: "AuthPrompt" }>

type AuthEffectContext = MenuViewContext & {
  readonly runner: MenuRunner
  readonly setSshActive: (isActive: boolean) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
  readonly cwd: string
}

type TerminalAuthProvider = "ClaudeOauth" | "GeminiOauth" | "GrokOauth"

const missingAuthTerminalSessionError = (provider: TerminalAuthProvider): MenuError => ({
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
  provider: TerminalAuthProvider,
  labelOption: string | null
): Effect.Effect<void, MenuError, MenuEnv> =>
  createAuthTerminalSession(provider, labelOption).pipe(
    Effect.flatMap((session) =>
      session === null
        ? Effect.fail(missingAuthTerminalSessionError(provider))
        : attachTerminalSession({
          header: terminalAuthTitle(provider),
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
    Match.when("CodexOauth", () =>
      codexLogin({
        _tag: "AuthCodexLogin",
        label: labelOption,
        codexAuthPath: view.snapshot.codexAuthPath
      })),
    Match.when("CodexLogout", () =>
      codexLogout({
        _tag: "AuthCodexLogout",
        label: labelOption,
        codexAuthPath: view.snapshot.codexAuthPath
      })),
    Match.when("ClaudeOauth", () => resolveTerminalAuthEffect("ClaudeOauth", labelOption)),
    Match.when("ClaudeLogout", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GeminiOauth", () => resolveTerminalAuthEffect("GeminiOauth", labelOption)),
    Match.when("GeminiApiKey", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GeminiLogout", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GrokOauth", () => resolveTerminalAuthEffect("GrokOauth", labelOption)),
    Match.when("GrokApiKey", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GrokLogout", (flow) => writeAuthFlow(cwd, flow, values)),
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
  const program = pipe(
    effect,
    Effect.zipRight(readAuthSnapshot(context.cwd)),
    Effect.tap((snapshot) =>
      Effect.sync(() => {
        startAuthMenuWithSnapshot(snapshot, context)
        context.setMessage(successMessage(view.flow, label))
      })
    ),
    Effect.ensuring(
      Effect.sync(() => {
        if (!options.suspendTui) {
          return
        }

        context.setSshActive(false)
        context.setSkipInputs(() => 2)
      })
    ),
    Effect.asVoid
  )

  context.setSshActive(options.suspendTui)
  if (options.suspendTui) {
    context.runner.runInteractiveEffect(program)
    return
  }
  context.runner.runEffect(program)
}
