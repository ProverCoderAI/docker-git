import { normalizeClaudeOauthToken } from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"
import { Effect, Match } from "effect"

import { AuthError } from "../shell/errors.js"

export type ClaudeLoginProbeStatus =
  | { readonly _tag: "ClaudeLoginProbeSucceeded"; readonly exitCode: 0 }
  | { readonly _tag: "ClaudeLoginProbeFailed"; readonly exitCode: number }

export type ClaudeLoginFlowResult = {
  readonly accountLabel: string
  readonly probeStatus: ClaudeLoginProbeStatus
}

export type ClaudeLoginFlowSpec<ELogin, EStore, EProbe, ESync, RLogin, RStore, RProbe, RSync> = {
  readonly accountLabel: string
  readonly captureToken: Effect.Effect<string, ELogin, RLogin>
  readonly persistToken: (token: string) => Effect.Effect<void, EStore, RStore>
  readonly normalizeStoredCredentials: Effect.Effect<void, EStore, RStore>
  readonly probeToken: (token: string) => Effect.Effect<number, EProbe, RProbe>
  readonly syncState: Effect.Effect<void, ESync, RSync>
}

const probeStatusFromExitCode = (exitCode: number): ClaudeLoginProbeStatus =>
  exitCode === 0
    ? { _tag: "ClaudeLoginProbeSucceeded", exitCode }
    : { _tag: "ClaudeLoginProbeFailed", exitCode }

const warnOnProbeFailure = (
  accountLabel: string,
  status: ClaudeLoginProbeStatus
): Effect.Effect<void> =>
  Match.value(status).pipe(
    Match.when({ _tag: "ClaudeLoginProbeSucceeded" }, () => Effect.void),
    Match.when({ _tag: "ClaudeLoginProbeFailed" }, ({ exitCode }) =>
      Effect.logWarning(
        `Claude OAuth token saved (${accountLabel}), but the API probe failed (exit=${exitCode}). ` +
          `Login is complete because the token was captured and persisted; live Claude API access is not yet verified. ` +
          `The token may need a moment to activate, or there was a transient network issue. ` +
          `Verify later with 'docker-git auth claude status'.`
      )),
    Match.exhaustive
  )

const ensureClaudeOauthToken = (rawToken: string): Effect.Effect<string, AuthError> => {
  const token = normalizeClaudeOauthToken(rawToken)
  return token === null
    ? Effect.fail(new AuthError({ message: "Claude OAuth token is empty." }))
    : Effect.succeed(token)
}

// CHANGE: isolate Claude login policy from the Docker-specific runner
// WHY: issue-439 is a policy invariant: captured token persistence must not depend on the live API probe result
// REF: issue-439
// SOURCE: n/a
// FORMAT THEOREM: forall token, probe: non_empty(token) -> persisted(token) before probe_result(probe)
// PURITY: SHELL
// EFFECT: Effect<ClaudeLoginFlowResult, AuthError | E*, R*>
// INVARIANT: a non-empty captured token is persisted before the post-login probe is interpreted
// COMPLEXITY: O(login + persist + probe + sync)
export const runClaudeLoginFlow = <ELogin, EStore, EProbe, ESync, RLogin, RStore, RProbe, RSync>(
  spec: ClaudeLoginFlowSpec<ELogin, EStore, EProbe, ESync, RLogin, RStore, RProbe, RSync>
): Effect.Effect<
  ClaudeLoginFlowResult,
  AuthError | ELogin | EStore | EProbe | ESync,
  RLogin | RStore | RProbe | RSync
> =>
  Effect.gen(function*(_) {
    const token = yield* _(spec.captureToken.pipe(Effect.flatMap(ensureClaudeOauthToken)))
    yield* _(spec.persistToken(token))
    yield* _(spec.normalizeStoredCredentials)
    const probeExitCode = yield* _(spec.probeToken(token))
    const probeStatus = probeStatusFromExitCode(probeExitCode)
    yield* _(warnOnProbeFailure(spec.accountLabel, probeStatus))
    yield* _(spec.syncState)
    return {
      accountLabel: spec.accountLabel,
      probeStatus
    } satisfies ClaudeLoginFlowResult
  })
