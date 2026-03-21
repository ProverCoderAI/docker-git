import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { AuthClaudeLoginCommand, AuthClaudeLogoutCommand, AuthClaudeStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import { runDockerAuth, runDockerAuthExitCode } from "../shell/docker-auth.js"
import type { AuthError } from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import { runClaudeOauthLoginWithPrompt } from "./auth-claude-oauth.js"
import { buildDockerAuthSpec, isRegularFile, normalizeAccountLabel } from "./auth-helpers.js"
import { migrateLegacyOrchLayout } from "./auth-sync.js"
import { ensureDockerImage } from "./docker-image.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"
import { autoSyncState } from "./state-repo.js"

type ClaudeRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
type ClaudeAuthMethod = "none" | "oauth-token" | "claude-ai-session"

type ClaudeAccountContext = {
  readonly accountLabel: string
  readonly accountPath: string
  readonly cwd: string
  readonly fs: FileSystem.FileSystem
}

export const claudeAuthRoot = ".docker-git/.orch/auth/claude"

const claudeImageName = "docker-git-auth-claude:latest"
const claudeImageDir = ".docker-git/.orch/auth/claude/.image"
const claudeContainerHomeDir = "/claude-home"
const claudeOauthTokenFileName = ".oauth-token"
const claudeConfigFileName = ".claude.json"
const claudeCredentialsFileName = ".credentials.json"
const claudeCredentialsDirName = ".claude"

const claudeOauthTokenPath = (accountPath: string): string => `${accountPath}/${claudeOauthTokenFileName}`
const claudeConfigPath = (accountPath: string): string => `${accountPath}/${claudeConfigFileName}`
const claudeCredentialsPath = (accountPath: string): string => `${accountPath}/${claudeCredentialsFileName}`
const claudeNestedCredentialsPath = (accountPath: string): string =>
  `${accountPath}/${claudeCredentialsDirName}/${claudeCredentialsFileName}`

const syncClaudeCredentialsFile = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const nestedPath = claudeNestedCredentialsPath(accountPath)
    const rootPath = claudeCredentialsPath(accountPath)
    const nestedExists = yield* _(isRegularFile(fs, nestedPath))
    if (nestedExists) {
      yield* _(fs.copyFile(nestedPath, rootPath))
      yield* _(fs.chmod(rootPath, 0o600), Effect.orElseSucceed(() => void 0))
      return
    }

    const rootExists = yield* _(isRegularFile(fs, rootPath))
    if (rootExists) {
      const nestedDirPath = `${accountPath}/${claudeCredentialsDirName}`
      yield* _(fs.makeDirectory(nestedDirPath, { recursive: true }))
      yield* _(fs.copyFile(rootPath, nestedPath))
      yield* _(fs.chmod(nestedPath, 0o600), Effect.orElseSucceed(() => void 0))
    }
  })

const clearClaudeSessionCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    yield* _(fs.remove(claudeCredentialsPath(accountPath), { force: true }))
    yield* _(fs.remove(claudeNestedCredentialsPath(accountPath), { force: true }))
  })

const hasNonEmptyOauthToken = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const tokenPath = claudeOauthTokenPath(accountPath)
    const hasToken = yield* _(isRegularFile(fs, tokenPath))
    if (!hasToken) {
      return false
    }
    const tokenText = yield* _(fs.readFileString(tokenPath), Effect.orElseSucceed(() => ""))
    return tokenText.trim().length > 0
  })

const readOauthToken = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    const tokenPath = claudeOauthTokenPath(accountPath)
    const hasToken = yield* _(isRegularFile(fs, tokenPath))
    if (!hasToken) {
      return null
    }

    const tokenText = yield* _(fs.readFileString(tokenPath), Effect.orElseSucceed(() => ""))
    const token = tokenText.trim()
    return token.length > 0 ? token : null
  })

const resolveClaudeAuthMethod = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<ClaudeAuthMethod, PlatformError> =>
  Effect.gen(function*(_) {
    const hasOauthToken = yield* _(hasNonEmptyOauthToken(fs, accountPath))
    if (hasOauthToken) {
      yield* _(clearClaudeSessionCredentials(fs, accountPath))
      return "oauth-token"
    }

    yield* _(syncClaudeCredentialsFile(fs, accountPath))
    const hasCredentials = yield* _(isRegularFile(fs, claudeCredentialsPath(accountPath)))
    return hasCredentials ? "claude-ai-session" : "none"
  })

const buildClaudeAuthEnv = (
  interactive: boolean,
  oauthToken: string | null = null
): ReadonlyArray<string> => [
  ...(interactive
    ? [`HOME=${claudeContainerHomeDir}`, `CLAUDE_CONFIG_DIR=${claudeContainerHomeDir}`, "BROWSER=echo"]
    : [`HOME=${claudeContainerHomeDir}`, `CLAUDE_CONFIG_DIR=${claudeContainerHomeDir}`]),
  ...(oauthToken === null ? [] : [`CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`])
]

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

const renderClaudeDockerfile = (): string =>
  String.raw`FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bsdutils \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && node -v \
  && npm -v \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code@latest
ENTRYPOINT ["claude"]
`

const resolveClaudeAccountPath = (path: Path.Path, rootPath: string, label: string | null): {
  readonly accountLabel: string
  readonly accountPath: string
} => {
  const accountLabel = normalizeAccountLabel(label, "default")
  const accountPath = path.join(rootPath, accountLabel)
  return { accountLabel, accountPath }
}

const withClaudeAuth = <A, E>(
  command: AuthClaudeLoginCommand | AuthClaudeLogoutCommand | AuthClaudeStatusCommand,
  run: (
    context: ClaudeAccountContext
  ) => Effect.Effect<A, E, CommandExecutor.CommandExecutor>
): Effect.Effect<A, E | PlatformError | CommandFailedError, ClaudeRuntime> =>
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
          dockerfile: renderClaudeDockerfile(),
          buildLabel: "claude auth"
        })
      )
      return yield* _(run({ accountLabel, accountPath, cwd, fs }))
    })
  )

const runClaudeAuthCommand = (
  cwd: string,
  accountPath: string,
  args: ReadonlyArray<string>,
  commandLabel: string,
  interactive: boolean
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuth(
    buildDockerAuthSpec({
      cwd,
      image: claudeImageName,
      hostPath: accountPath,
      containerPath: claudeContainerHomeDir,
      env: buildClaudeAuthEnv(interactive),
      args,
      interactive
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
  oauthToken: string | null
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuthExitCode(
    buildDockerAuthSpec({
      cwd,
      image: claudeImageName,
      hostPath: accountPath,
      containerPath: claudeContainerHomeDir,
      env: buildClaudeAuthEnv(false, oauthToken),
      args: ["-p", "ping"],
      interactive: false
    })
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
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, ClaudeRuntime> => {
  const accountLabel = normalizeAccountLabel(command.label, "default")
  return withClaudeAuth(command, ({ accountPath, cwd, fs }) =>
    Effect.gen(function*(_) {
      const token = yield* _(
        runClaudeOauthLoginWithPrompt(cwd, accountPath, {
          image: claudeImageName,
          containerPath: claudeContainerHomeDir
        })
      )
      yield* _(fs.writeFileString(claudeOauthTokenPath(accountPath), `${token}\n`))
      yield* _(fs.chmod(claudeOauthTokenPath(accountPath), 0o600), Effect.orElseSucceed(() => void 0))
      yield* _(resolveClaudeAuthMethod(fs, accountPath))
      const probeExitCode = yield* _(runClaudePingProbeExitCode(cwd, accountPath, token))
      if (probeExitCode !== 0) {
        yield* _(
          Effect.fail(
            new CommandFailedError({
              command: "claude setup-token",
              exitCode: probeExitCode
            })
          )
        )
      }
    })).pipe(
      Effect.zipRight(autoSyncState(`chore(state): auth claude ${accountLabel}`))
    )
}

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
  withClaudeAuth(command, ({ accountLabel, accountPath, cwd, fs }) =>
    Effect.gen(function*(_) {
      const method = yield* _(resolveClaudeAuthMethod(fs, accountPath))
      if (method === "none") {
        yield* _(Effect.log(`Claude not connected (${accountLabel}).`))
        return
      }

      const oauthToken = method === "oauth-token" ? yield* _(readOauthToken(fs, accountPath)) : null
      const probeExitCode = yield* _(runClaudePingProbeExitCode(cwd, accountPath, oauthToken))
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
