import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

import type { AuthClaudeLoginCommand, AuthClaudeLogoutCommand, AuthClaudeStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import { runDockerAuth, runDockerAuthCapture } from "../shell/docker-auth.js"
import type { AuthError } from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import { runClaudeOauthLoginWithPrompt } from "./auth-claude-oauth.js"
import { buildDockerAuthSpec, normalizeAccountLabel } from "./auth-helpers.js"
import { migrateLegacyOrchLayout } from "./auth-sync.js"
import { ensureDockerImage } from "./docker-image.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"
import { autoSyncState } from "./state-repo.js"

type ClaudeRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type ClaudeAccountContext = {
  readonly accountLabel: string
  readonly accountPath: string
  readonly cwd: string
  readonly fs: FileSystem.FileSystem
}

export const claudeAuthRoot = ".docker-git/.orch/auth/claude"

const claudeImageName = "docker-git-auth-claude:latest"
const claudeImageDir = ".docker-git/.orch/auth/claude/.image"
const claudeConfigDir = "/claude-config"
const claudeOauthTokenFileName = ".oauth-token"

const claudeOauthTokenPath = (accountPath: string): string => `${accountPath}/${claudeOauthTokenFileName}`

const ensureClaudeOrchLayout = (
  cwd: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(
    cwd,
    defaultTemplateConfig.envGlobalPath,
    defaultTemplateConfig.envProjectPath,
    defaultTemplateConfig.codexAuthPath,
    ".docker-git/.orch/auth/gh"
  )

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
      containerPath: claudeConfigDir,
      env: [`CLAUDE_CONFIG_DIR=${claudeConfigDir}`, "BROWSER=echo"],
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

const runClaudeStatusJson = (
  cwd: string,
  accountPath: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuthCapture(
    buildDockerAuthSpec({
      cwd,
      image: claudeImageName,
      hostPath: accountPath,
      containerPath: claudeConfigDir,
      env: `CLAUDE_CONFIG_DIR=${claudeConfigDir}`,
      args: ["auth", "status", "--json"],
      interactive: false
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: "claude auth status --json", exitCode })
  )

type ClaudeAuthStatus = {
  readonly loggedIn: boolean
  readonly authMethod?: string | undefined
  readonly apiProvider?: string | undefined
}

const ClaudeAuthStatusSchema = Schema.Struct({
  loggedIn: Schema.Boolean,
  authMethod: Schema.optional(Schema.String),
  apiProvider: Schema.optional(Schema.String)
})

const ClaudeAuthStatusJsonSchema = Schema.parseJson(ClaudeAuthStatusSchema)

const decodeClaudeAuthStatus = (raw: string): Effect.Effect<ClaudeAuthStatus, CommandFailedError> =>
  Either.match(ParseResult.decodeUnknownEither(ClaudeAuthStatusJsonSchema)(raw), {
    onLeft: () => Effect.fail(new CommandFailedError({ command: "claude auth status --json", exitCode: 1 })),
    onRight: (value) => Effect.succeed(value)
  })

// CHANGE: login to Claude Code CLI using a dedicated auth container (OAuth web flow)
// WHY: mirror the isolated OAuth flow used for Codex/GitHub (no API key entry in TUI)
// QUOTE(ТЗ): "ДЕЛАЙ OAuth по тому же принципу что и Codex"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall l: login(l) -> claude_auth_cache_exists(l)
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | CommandFailedError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: CLAUDE_CONFIG_DIR is pinned to the mounted auth directory
// COMPLEXITY: O(command)
export const authClaudeLogin = (
  command: AuthClaudeLoginCommand
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, ClaudeRuntime> => {
  const accountLabel = normalizeAccountLabel(command.label, "default")
  return withClaudeAuth(command, ({ accountPath, cwd, fs }) =>
    runClaudeOauthLoginWithPrompt(cwd, accountPath, {
      image: claudeImageName,
      containerPath: claudeConfigDir
    }).pipe(
      Effect.flatMap((token) => fs.writeFileString(claudeOauthTokenPath(accountPath), `${token}\n`))
    )).pipe(
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
      const tokenPath = claudeOauthTokenPath(accountPath)
      const hasToken = yield* _(fs.exists(tokenPath))
      if (hasToken) {
        const tokenText = yield* _(fs.readFileString(tokenPath), Effect.orElseSucceed(() => ""))
        if (tokenText.trim().length > 0) {
          yield* _(Effect.log(`Claude connected (${accountLabel}, oauth-token).`))
          return
        }
      }

      const raw = yield* _(runClaudeStatusJson(cwd, accountPath))
      const status = yield* _(decodeClaudeAuthStatus(raw))
      yield* (status.loggedIn
        ? _(Effect.log(`Claude connected (${accountLabel}).`))
        : _(Effect.log(`Claude not connected (${accountLabel}).`)))
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
          const tokenPath = claudeOauthTokenPath(accountPath)
          const hasToken = yield* _(fs.exists(tokenPath))
          if (hasToken) {
            yield* _(fs.remove(tokenPath, { force: true }))
          }
          yield* _(runClaudeLogout(cwd, accountPath))
        }))
    )
    yield* _(autoSyncState(`chore(state): auth claude logout ${accountLabel}`))
  }).pipe(Effect.asVoid)
