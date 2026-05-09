import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Duration, Effect, Match, Schedule } from "effect"

import type { AuthGitlabLoginCommand, AuthGitlabLogoutCommand, AuthGitlabStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import { trimLeftChar, trimRightChar } from "../core/strings.js"
import { runDockerAuth, runDockerAuthCapture } from "../shell/docker-auth.js"
import type { AuthError } from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import { buildDockerAuthSpec, normalizeAccountLabel } from "./auth-helpers.js"
import { migrateLegacyOrchLayout } from "./auth-sync.js"
import { ensureEnvFile, parseEnvEntries, readEnvText, removeEnvKey, upsertEnvKey } from "./env-file.js"
import { ensureGlabAuthImage, gitlabAuthDir, gitlabAuthRoot, gitlabImageName } from "./gitlab-auth-image.js"
import type { GitlabTokenValidationResult } from "./gitlab-token-validation.js"
import { validateGitlabToken } from "./gitlab-token-validation.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"
import { autoSyncState } from "./state-repo.js"

type GitlabTokenEntry = {
  readonly key: string
  readonly label: string
  readonly token: string
}

type GitlabFsRuntime = FileSystem.FileSystem | Path.Path
type GitlabRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type EnvContext = {
  readonly fs: FileSystem.FileSystem
  readonly envPath: string
  readonly current: string
}

type GitlabTokenStatusEntry = GitlabTokenEntry & GitlabTokenValidationResult

const ensureGitlabOrchLayout = (
  cwd: string,
  envGlobalPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath: defaultTemplateConfig.codexAuthPath,
    ghAuthPath: ".docker-git/.orch/auth/gh",
    gitlabAuthPath: gitlabAuthRoot,
    claudeAuthPath: ".docker-git/.orch/auth/claude"
  })

const normalizeGitlabLabel = (value: string | null): string => {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) {
    return ""
  }
  const normalized = trimmed.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")
  const withoutLeading = trimLeftChar(normalized, "_")
  const cleaned = trimRightChar(withoutLeading, "_")
  return cleaned.length > 0 ? cleaned : ""
}

const tokenKey = "GITLAB_TOKEN"
const tokenPrefix = "GITLAB_TOKEN__"

export const buildGitlabTokenKey = (label: string | null): string => {
  const normalized = normalizeGitlabLabel(label)
  if (normalized === "DEFAULT" || normalized.length === 0) {
    return tokenKey
  }
  return `${tokenPrefix}${normalized}`
}

export const gitlabLabelFromKey = (key: string): string =>
  key.startsWith(tokenPrefix) ? key.slice(tokenPrefix.length) : "default"

export const listGitlabTokens = (envText: string): ReadonlyArray<GitlabTokenEntry> =>
  parseEnvEntries(envText)
    .filter((entry) => entry.key === tokenKey || entry.key.startsWith(tokenPrefix))
    .map((entry) => ({
      key: entry.key,
      label: gitlabLabelFromKey(entry.key),
      token: entry.value
    }))
    .filter((entry) => entry.token.trim().length > 0)

const withEnvContext = <A, E, R>(
  envGlobalPath: string,
  run: (context: EnvContext) => Effect.Effect<A, E, FileSystem.FileSystem | R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Path.Path | R> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureGitlabOrchLayout(cwd, envGlobalPath))
      const envPath = resolvePathFromCwd(path, cwd, envGlobalPath)
      const current = yield* _(readEnvText(fs, envPath))
      return yield* _(run({ fs, envPath, current }))
    })
  )

const renderGitlabTokenStatusLine = (entry: GitlabTokenStatusEntry): string =>
  Match.value(entry.status).pipe(
    Match.when("valid", () =>
      entry.login === null
        ? `- ${entry.label}: valid (owner unavailable)`
        : `- ${entry.label}: valid (owner: ${entry.login})`),
    Match.when("invalid", () => `- ${entry.label}: invalid`),
    Match.when("unknown", () => `- ${entry.label}: unknown (validation unavailable)`),
    Match.exhaustive
  )

const renderGitlabTokenStatusReport = (entries: ReadonlyArray<GitlabTokenStatusEntry>): string =>
  [`GitLab tokens (${entries.length}):`, ...entries.map((entry) => renderGitlabTokenStatusLine(entry))].join("\n")

const validateGitlabTokenEntry = (
  entry: GitlabTokenEntry
): Effect.Effect<GitlabTokenStatusEntry> =>
  validateGitlabToken(entry.token).pipe(
    Effect.map((validation) => ({
      key: entry.key,
      label: entry.label,
      token: entry.token,
      status: validation.status,
      login: validation.login
    }))
  )

const tokenCandidatePatterns: ReadonlyArray<RegExp> = [
  /token:\s*([^\s]+)/iu,
  /GITLAB_TOKEN[=:]\s*([^\s]+)/u
]

export const extractGitlabTokenFromStatusOutput = (output: string): string | null => {
  for (const line of output.split(/\r?\n/u)) {
    for (const pattern of tokenCandidatePatterns) {
      const match = pattern.exec(line)
      const token = match?.[1]?.trim()
      if (token && token.length > 0 && !token.includes("*")) {
        return token
      }
    }
  }
  return null
}

const resolveGitlabTokenFromGlab = (
  cwd: string,
  accountPath: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuthCapture(
    buildDockerAuthSpec({
      cwd,
      image: gitlabImageName,
      hostPath: accountPath,
      containerPath: gitlabAuthDir,
      env: `GLAB_CONFIG_DIR=${gitlabAuthDir}`,
      args: ["auth", "status", "--hostname", "gitlab.com", "--show-token"],
      interactive: false
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: "glab auth status --show-token", exitCode })
  ).pipe(
    Effect.map((raw) => extractGitlabTokenFromStatusOutput(raw)),
    Effect.filterOrFail(
      (value): value is string => value !== null && value.length > 0,
      () => new CommandFailedError({ command: "glab auth status --show-token", exitCode: 1 })
    )
  )

const runGitlabLogin = (
  cwd: string,
  accountPath: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuth(
    buildDockerAuthSpec({
      cwd,
      image: gitlabImageName,
      hostPath: accountPath,
      containerPath: gitlabAuthDir,
      env: ["BROWSER=echo", `GLAB_CONFIG_DIR=${gitlabAuthDir}`],
      args: [
        "auth",
        "login",
        "--hostname",
        "gitlab.com",
        "--web",
        "--git-protocol",
        "https"
      ],
      interactive: false
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: "glab auth login --web", exitCode })
  )

const retryGitlabLogin = (
  effect: Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor>
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  effect.pipe(
    Effect.tapError(() => Effect.logWarning("GitLab auth login failed; retrying...")),
    Effect.retry(
      Schedule.addDelay(
        Schedule.recurs(2),
        () => Duration.seconds(2)
      )
    )
  )

const persistGitlabToken = (
  fs: FileSystem.FileSystem,
  envPath: string,
  key: string,
  token: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const current = yield* _(readEnvText(fs, envPath))
    const nextText = upsertEnvKey(current, key, token)
    yield* _(fs.writeFileString(envPath, nextText))
    const label = gitlabLabelFromKey(key)
    yield* _(Effect.log(`GitLab token stored (${label}) in ${envPath}`))
  })

const runGitlabInteractiveLogin = (
  cwd: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
  envPath: string,
  command: AuthGitlabLoginCommand
): Effect.Effect<string, AuthError | CommandFailedError | PlatformError, GitlabRuntime> =>
  Effect.gen(function*(_) {
    const rootPath = resolvePathFromCwd(path, cwd, gitlabAuthRoot)
    const accountLabel = normalizeAccountLabel(command.label, "default")
    const accountPath = path.join(rootPath, accountLabel)
    yield* _(fs.makeDirectory(accountPath, { recursive: true }))
    yield* _(ensureGlabAuthImage(fs, path, cwd, "glab auth"))
    yield* _(Effect.log("Starting GitLab auth login in container..."))
    yield* _(retryGitlabLogin(runGitlabLogin(cwd, accountPath)))
    const resolved = yield* _(resolveGitlabTokenFromGlab(cwd, accountPath))
    yield* _(ensureEnvFile(fs, path, envPath))
    const key = buildGitlabTokenKey(command.label)
    yield* _(persistGitlabToken(fs, envPath, key, resolved))
    return resolved
  })

export const authGitlabLogin = (
  command: AuthGitlabLoginCommand
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, GitlabRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureGitlabOrchLayout(cwd, command.envGlobalPath))
      const envPath = resolvePathFromCwd(path, cwd, command.envGlobalPath)
      const token = command.token?.trim() ?? ""
      const key = buildGitlabTokenKey(command.label)
      const label = gitlabLabelFromKey(key)
      if (token.length > 0) {
        yield* _(ensureEnvFile(fs, path, envPath))
        yield* _(persistGitlabToken(fs, envPath, key, token))
        yield* _(autoSyncState(`chore(state): auth gitlab ${label}`))
        return
      }
      yield* _(runGitlabInteractiveLogin(cwd, fs, path, envPath, command))
      yield* _(autoSyncState(`chore(state): auth gitlab ${label}`))
    })
  )

export const authGitlabStatus = (
  command: AuthGitlabStatusCommand
): Effect.Effect<void, PlatformError, GitlabFsRuntime> =>
  withEnvContext(command.envGlobalPath, ({ current, envPath }) =>
    Effect.gen(function*(_) {
      const tokens = listGitlabTokens(current)
      if (tokens.length === 0) {
        yield* _(Effect.log(`GitLab not connected (no tokens in ${envPath}).`))
        return
      }

      const statuses = yield* _(Effect.all(tokens.map((entry) => validateGitlabTokenEntry(entry))))

      yield* _(Effect.log(renderGitlabTokenStatusReport(statuses)))
    }))

export const authGitlabLogout = (
  command: AuthGitlabLogoutCommand
): Effect.Effect<void, PlatformError, GitlabRuntime> =>
  withEnvContext(command.envGlobalPath, ({ current, envPath, fs }) =>
    Effect.gen(function*(_) {
      const key = buildGitlabTokenKey(command.label)
      const nextText = removeEnvKey(current, key)
      yield* _(fs.writeFileString(envPath, nextText))
      const label = gitlabLabelFromKey(key)
      yield* _(Effect.log(`GitLab token removed (${label}) from ${envPath}`))
      yield* _(autoSyncState(`chore(state): auth gitlab logout ${label}`))
    }))
