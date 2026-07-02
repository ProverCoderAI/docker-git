import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import {
  claudeCodeOauthTokenEnvKey,
  dockerGitClaudeOauthTokenEnvKey,
  readClaudeOauthTokenFromEnv
} from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"
import { Effect } from "effect"

import { runCommandExitCode } from "../shell/command-runner.js"
import { AuthError } from "../shell/errors.js"
import { type ClaudeLoginFlowResult, runClaudeLoginFlow } from "./auth-claude-login-flow.js"

export type ClaudeLocalLoginFlowSpec<EStore, ESync, RStore, RSync> = {
  readonly cwd: string
  readonly accountLabel: string
  readonly accountPath: string
  readonly env: NodeJS.ProcessEnv
  readonly persistToken: (token: string) => Effect.Effect<void, EStore, RStore>
  readonly normalizeStoredCredentials: Effect.Effect<void, EStore, RStore>
  readonly syncState: Effect.Effect<void, ESync, RSync>
}

export const readClaudeLocalOauthTokenFromEnv = (
  env: NodeJS.ProcessEnv
): Effect.Effect<string, AuthError> => {
  const token = readClaudeOauthTokenFromEnv(env, [dockerGitClaudeOauthTokenEnvKey, claudeCodeOauthTokenEnvKey])
  return token === null
    ? Effect.fail(
      new AuthError({
        message:
          `Set ${dockerGitClaudeOauthTokenEnvKey} or ${claudeCodeOauthTokenEnvKey} to run the local Claude auth smoke.`
      })
    )
    : Effect.succeed(token)
}

export const buildClaudeLocalEnv = (
  accountPath: string,
  oauthToken: string
): Readonly<Record<string, string>> => ({
  CLAUDE_CONFIG_DIR: `${accountPath}/.probe-home`,
  CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
  HOME: `${accountPath}/.probe-home`
})

export const runClaudeLocalPingProbeExitCode = (
  cwd: string,
  accountPath: string,
  oauthToken: string
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor | FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    yield* _(fs.makeDirectory(`${accountPath}/.probe-home`, { recursive: true }))
    return yield* _(
      runCommandExitCode({
        cwd,
        command: "claude",
        args: ["-p", "ping"],
        env: buildClaudeLocalEnv(accountPath, oauthToken)
      })
    )
  })

// CHANGE: provide a no-Docker Claude auth smoke runner
// WHY: local environments may have Claude CLI and token access even when nested Docker is unavailable
// REF: issue-439
// SOURCE: n/a
// FORMAT THEOREM: forall env: token(env) -> same login policy as docker runner
// PURITY: SHELL
// EFFECT: Effect<ClaudeLoginFlowResult, AuthError | PlatformError | E*, CommandExecutor | R*>
// INVARIANT: local smoke uses a caller-provided accountPath and never logs token material
// COMPLEXITY: O(probe)
export const runClaudeLocalEnvTokenLoginFlow = <EStore, ESync, RStore, RSync>(
  spec: ClaudeLocalLoginFlowSpec<EStore, ESync, RStore, RSync>
): Effect.Effect<
  ClaudeLoginFlowResult,
  AuthError | PlatformError | EStore | ESync,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem | RStore | RSync
> =>
  runClaudeLoginFlow({
    accountLabel: spec.accountLabel,
    captureToken: readClaudeLocalOauthTokenFromEnv(spec.env),
    persistToken: spec.persistToken,
    normalizeStoredCredentials: spec.normalizeStoredCredentials,
    probeToken: (token) => runClaudeLocalPingProbeExitCode(spec.cwd, spec.accountPath, token),
    syncState: spec.syncState
  })
