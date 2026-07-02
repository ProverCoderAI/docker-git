import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { renderClaudeDockerOauthDockerfile } from "@prover-coder-ai/docker-git-auth-oauth/claude-docker-oauth"
import { claudeOauthTokenPath } from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"
import { Effect, Match } from "effect"

import type { AuthClaudeLoginCommand, AuthClaudeLogoutCommand, AuthClaudeStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import { runDockerAuth, runDockerAuthExitCode } from "../shell/docker-auth.js"
import type { AuthError } from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import {
  claudeConfigPath,
  claudeCredentialsPath,
  claudeNestedCredentialsPath,
  normalizeAndResolveClaudeAuthMethod,
  persistClaudeOauthToken,
  readOauthToken
} from "./auth-claude-credentials.js"
import { runClaudeLoginFlow } from "./auth-claude-login-flow.js"
import { runClaudeOauthLoginWithPrompt } from "./auth-claude-oauth.js"
import { buildDockerAuthSpec, normalizeAccountLabel } from "./auth-helpers.js"
import { migrateLegacyOrchLayout } from "./auth-sync.js"
import { ensureDockerImage } from "./docker-image.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"
import { autoSyncState } from "./state-repo.js"

type ClaudeRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
type ClaudeProbeAuth =
  | { readonly _tag: "ClaudeProbeAccountConfig" }
  | { readonly _tag: "ClaudeProbeOauthToken"; readonly token: string }

type ClaudeAccountContext = {
  readonly accountLabel: string
  readonly accountPath: string
  readonly cwd: string
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
}

export const claudeAuthRoot = ".docker-git/.orch/auth/claude"

const claudeImageName = "docker-git-auth-claude:latest"
const claudeImageDir = ".docker-git/.orch/auth/claude/.image"
const claudeContainerHomeDir = "/claude-home"
const claudeProbeConfigDir = "/claude-probe-home"
const claudeProbeTmpfs = `${claudeProbeConfigDir}:rw,size=16m,mode=1777`
const claudeProbeEnvFileMode = 0o600

const buildClaudeAuthEnv = (
  isInteractive: boolean,
  oauthToken: string | null = null
): ReadonlyArray<string> => [
  ...(isInteractive
    ? [`HOME=${claudeContainerHomeDir}`, `CLAUDE_CONFIG_DIR=${claudeContainerHomeDir}`, "BROWSER=echo"]
    : [`HOME=${claudeContainerHomeDir}`, `CLAUDE_CONFIG_DIR=${claudeContainerHomeDir}`]),
  ...(oauthToken === null ? [] : [`CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`])
]

// CHANGE: isolate non-interactive Claude OAuth probes from account settings
// WHY: account settings may intentionally use bypassPermissions for real sessions, but Claude rejects that mode under root/sudo probe contexts
// QUOTE(ТЗ): "почему не работает команда bun run docker-git auth claude login"
// REF: user-report-2026-07-01-claude-auth-login
// SOURCE: n/a
// FORMAT THEOREM: forall token: probe(token) reads token env and not account(settings.json)
// PURITY: CORE
// INVARIANT: probe uses the persisted OAuth token without inheriting account permission settings
// COMPLEXITY: O(1)
const buildClaudeProbeEnv = (auth: ClaudeProbeAuth): ReadonlyArray<string> =>
  Match.value(auth).pipe(
    Match.when({ _tag: "ClaudeProbeAccountConfig" }, () => buildClaudeAuthEnv(false)),
    Match.when({ _tag: "ClaudeProbeOauthToken" }, () => [
      `HOME=${claudeProbeConfigDir}`,
      `CLAUDE_CONFIG_DIR=${claudeProbeConfigDir}`
    ]),
    Match.exhaustive
  )

const withClaudeProbeTokenEnvFile = <A, E, R>(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  accountPath: string,
  token: string,
  use: (envFilePath: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, R> =>
  Effect.gen(function*(_) {
    const envDir = yield* _(fs.makeTempDirectory({ directory: accountPath, prefix: ".claude-probe-env-" }))
    const envFilePath = path.join(envDir, "probe.env")
    const cleanup = fs.remove(envDir, { recursive: true, force: true }).pipe(
      Effect.orElseSucceed(() => void 0)
    )
    return yield* _(
      Effect.gen(function*(_) {
        yield* _(fs.writeFileString(envFilePath, `CLAUDE_CODE_OAUTH_TOKEN=${token}\n`, { mode: claudeProbeEnvFileMode }))
        yield* _(fs.chmod(envFilePath, claudeProbeEnvFileMode))
        return yield* _(use(envFilePath))
      }).pipe(Effect.ensuring(cleanup))
    )
  })

const ensureClaudeOrchLayout = (
  cwd: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath: defaultTemplateConfig.envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath: defaultTemplateConfig.codexAuthPath,
    ghAuthPath: ".docker-git/.orch/auth/gh",
    claudeAuthPath: ".docker-git/.orch/auth/claude"
  })

const resolveClaudeAccountPath = (path: Path.Path, rootPath: string, label: string | null): {
  readonly accountLabel: string
  readonly accountPath: string
} => {
  const accountLabel = normalizeAccountLabel(label, "default")
  const accountPath = path.join(rootPath, accountLabel)
  return { accountLabel, accountPath }
}

const withClaudeAuth = <A, E, R>(
  command: AuthClaudeLoginCommand | AuthClaudeLogoutCommand | AuthClaudeStatusCommand,
  run: (
    context: ClaudeAccountContext
  ) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError | CommandFailedError, ClaudeRuntime | R> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureClaudeOrchLayout(cwd))
      const rootPath = resolvePathFromCwd(path, cwd, command.claudeAuthPath)
      const { accountLabel, accountPath } = resolveClaudeAccountPath(path, rootPath, command.label)
      yield* _(fs.makeDirectory(accountPath, { recursive: true }))
      yield* _(
        ensureDockerImage(fs, path, cwd, {
          imageName: claudeImageName,
          imageDir: claudeImageDir,
          dockerfile: renderClaudeDockerOauthDockerfile(),
          buildLabel: "claude auth"
        })
      )
      return yield* _(run({ accountLabel, accountPath, cwd, fs, path }))
    })
  )

const runClaudeAuthCommand = (
  cwd: string,
  accountPath: string,
  args: ReadonlyArray<string>,
  commandLabel: string,
  isInteractive: boolean
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuth(
    buildDockerAuthSpec({
      cwd,
      image: claudeImageName,
      hostPath: accountPath,
      containerPath: claudeContainerHomeDir,
      env: buildClaudeAuthEnv(isInteractive),
      args,
      interactive: isInteractive
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: commandLabel, exitCode })
  )

const runClaudeLogout = (
  cwd: string,
  accountPath: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runClaudeAuthCommand(cwd, accountPath, ["auth", "logout"], "claude auth logout", false)

const runClaudePingProbeExitCode = (
  cwd: string,
  accountPath: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
  auth: ClaudeProbeAuth
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  Match.value(auth).pipe(
    Match.when({ _tag: "ClaudeProbeAccountConfig" }, () =>
      runDockerAuthExitCode(
        buildDockerAuthSpec({
          cwd,
          image: claudeImageName,
          hostPath: accountPath,
          containerPath: claudeContainerHomeDir,
          env: buildClaudeProbeEnv(auth),
          args: ["-p", "ping"],
          interactive: false
        })
      )),
    Match.when({ _tag: "ClaudeProbeOauthToken" }, ({ token }) =>
      withClaudeProbeTokenEnvFile(fs, path, accountPath, token, (envFilePath) =>
        runDockerAuthExitCode(
          buildDockerAuthSpec({
            cwd,
            image: claudeImageName,
            hostPath: accountPath,
            containerPath: claudeContainerHomeDir,
            tmpfs: claudeProbeTmpfs,
            envFile: envFilePath,
            env: buildClaudeProbeEnv(auth),
            args: ["-p", "ping"],
            interactive: false
          })
        ))),
    Match.exhaustive
  )

// CHANGE: login to Claude Code CLI via interactive `claude setup-token` in isolated container
// WHY: `claude auth login` may stall in containerized TTY without presenting the code prompt
// QUOTE(ТЗ): "claude авторизация в docker-git рабочая"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall l: login(l) -> claude_auth_cache_exists(l)
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | CommandFailedError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: HOME and CLAUDE_CONFIG_DIR are pinned to the mounted auth directory
// COMPLEXITY: O(command)
export const authClaudeLogin = (
  command: AuthClaudeLoginCommand
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, ClaudeRuntime> =>
  withClaudeAuth(command, ({ accountLabel, accountPath, cwd, fs, path }) =>
    runClaudeLoginFlow({
      accountLabel,
      captureToken: runClaudeOauthLoginWithPrompt(cwd, accountPath, {
        image: claudeImageName,
        containerPath: claudeContainerHomeDir
      }),
      persistToken: (token) => persistClaudeOauthToken(fs, path, accountPath, token),
      normalizeStoredCredentials: normalizeAndResolveClaudeAuthMethod(fs, path, accountPath).pipe(Effect.asVoid),
      probeToken: (token) =>
        runClaudePingProbeExitCode(cwd, accountPath, fs, path, {
          _tag: "ClaudeProbeOauthToken",
          token
        }),
      syncState: autoSyncState(`chore(state): auth claude ${accountLabel}`)
    }).pipe(Effect.asVoid))

// CHANGE: show Claude Code auth status for a given label
// WHY: allow verifying OAuth cache presence without exposing credentials
// QUOTE(ТЗ): "где теперь можно изучить эти сессии?"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall l: status(l) -> connected(l) | disconnected(l)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: never logs tokens/credentials
// COMPLEXITY: O(command)
export const authClaudeStatus = (
  command: AuthClaudeStatusCommand
): Effect.Effect<void, CommandFailedError | PlatformError, ClaudeRuntime> =>
  withClaudeAuth(command, ({ accountLabel, accountPath, cwd, fs, path }) =>
    Effect.gen(function*(_) {
      const method = yield* _(normalizeAndResolveClaudeAuthMethod(fs, path, accountPath))
      if (method === "none") {
        yield* _(Effect.log(`Claude not connected (${accountLabel}).`))
        return
      }

      const oauthToken = method === "oauth-token" ? yield* _(readOauthToken(fs, accountPath)) : null
      const probeAuth: ClaudeProbeAuth = method === "oauth-token" && oauthToken !== null
        ? { _tag: "ClaudeProbeOauthToken", token: oauthToken }
        : { _tag: "ClaudeProbeAccountConfig" }
      const probeExitCode = yield* _(runClaudePingProbeExitCode(cwd, accountPath, fs, path, probeAuth))
      if (probeExitCode === 0) {
        yield* _(Effect.log(`Claude connected (${accountLabel}, ${method}).`))
        return
      }
      yield* _(
        Effect.logWarning(
          `Claude session exists but API probe failed (${accountLabel}, ${method}, exit=${probeExitCode}). Run 'docker-git auth claude login'.`
        )
      )
    }))

// CHANGE: logout Claude Code by clearing credentials for a label
// WHY: allow revoking Claude Code access deterministically
// QUOTE(ТЗ): "Надо сделать что бы ... можно создавать множество данных"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall l: logout(l) -> credentials_cleared(l)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: CLAUDE_CONFIG_DIR stays within the mounted account directory
// COMPLEXITY: O(command)
export const authClaudeLogout = (
  command: AuthClaudeLogoutCommand
): Effect.Effect<void, CommandFailedError | PlatformError, ClaudeRuntime> =>
  Effect.gen(function*(_) {
    const accountLabel = normalizeAccountLabel(command.label, "default")
    yield* _(
      withClaudeAuth(command, ({ accountPath, cwd, fs }) =>
        Effect.gen(function*(_) {
          yield* _(runClaudeLogout(cwd, accountPath))
          yield* _(fs.remove(claudeOauthTokenPath(accountPath), { force: true }))
          yield* _(fs.remove(claudeCredentialsPath(accountPath), { force: true }))
          yield* _(fs.remove(claudeNestedCredentialsPath(accountPath), { force: true }))
          yield* _(fs.remove(claudeConfigPath(accountPath), { force: true }))
        }))
    )
    yield* _(autoSyncState(`chore(state): auth claude logout ${accountLabel}`))
  }).pipe(Effect.asVoid)
