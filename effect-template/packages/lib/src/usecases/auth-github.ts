import type * as CommandExecutor from "@effect/platform/CommandExecutor"
// NOTE: keep platform type imports grouped for auth flows.
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Duration, Effect, Schedule } from "effect"

import type { AuthGithubLoginCommand, AuthGithubLogoutCommand, AuthGithubStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import { trimLeftChar, trimRightChar } from "../core/strings.js"
import { runDockerAuth, runDockerAuthCapture } from "../shell/docker-auth.js"
import type { AuthError } from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import { buildDockerAuthSpec, normalizeAccountLabel } from "./auth-helpers.js"
import { migrateLegacyOrchLayout } from "./auth-sync.js"
import { ensureDockerImage } from "./docker-image.js"
import { ensureEnvFile, parseEnvEntries, readEnvText, removeEnvKey, upsertEnvKey } from "./env-file.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"

type GithubTokenEntry = {
  readonly key: string
  readonly label: string
  readonly token: string
}

type GithubFsRuntime = FileSystem.FileSystem | Path.Path
type GithubRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type EnvContext = {
  readonly fs: FileSystem.FileSystem
  readonly envPath: string
  readonly current: string
}

const ghAuthRoot = ".docker-git/.orch/auth/gh"
const ghAuthDir = "/root/.config/gh"
const ghImageName = "docker-git-auth-gh:latest"
const ghImageDir = ".docker-git/.orch/auth/gh/.image"

const ensureGithubOrchLayout = (
  cwd: string,
  envGlobalPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(
    cwd,
    envGlobalPath,
    defaultTemplateConfig.envProjectPath,
    defaultTemplateConfig.codexAuthPath,
    ghAuthRoot
  )

const renderGhDockerfile = (): string =>
  String.raw`FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg bsdutils \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh git \
  && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["gh"]
`

const normalizeGithubLabel = (value: string | null): string => {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) {
    return ""
  }
  const normalized = trimmed.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")
  const withoutLeading = trimLeftChar(normalized, "_")
  const cleaned = trimRightChar(withoutLeading, "_")
  return cleaned.length > 0 ? cleaned : ""
}

const tokenKey = "GITHUB_TOKEN"
const tokenPrefix = "GITHUB_TOKEN__"

const buildGithubTokenKey = (label: string | null): string => {
  const normalized = normalizeGithubLabel(label)
  if (normalized === "DEFAULT" || normalized.length === 0) {
    return tokenKey
  }
  return `${tokenPrefix}${normalized}`
}

const labelFromKey = (key: string): string => key.startsWith(tokenPrefix) ? key.slice(tokenPrefix.length) : "default"

const listGithubTokens = (envText: string): ReadonlyArray<GithubTokenEntry> =>
  parseEnvEntries(envText)
    .filter((entry) => entry.key === tokenKey || entry.key.startsWith(tokenPrefix))
    .map((entry) => ({
      key: entry.key,
      label: labelFromKey(entry.key),
      token: entry.value
    }))
    .filter((entry) => entry.token.trim().length > 0)

const defaultGithubScopes = "repo,workflow,read:org"

// CHANGE: normalize GitHub scopes for gh auth login
// WHY: ensure required scopes are requested without delete_repo
// QUOTE(ТЗ): "Передай все нужные скопы"
// REF: user-request-2026-02-05-gh-scopes
// SOURCE: n/a
// FORMAT THEOREM: ∀s: normalize(s) -> scopes(s) ⊆ required
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: empty input yields default scopes
// COMPLEXITY: O(n) where n = |scopes|
const normalizeGithubScopes = (value: string | null | undefined): ReadonlyArray<string> => {
  const raw = value?.trim() ?? ""
  const input = raw.length === 0 ? defaultGithubScopes : raw
  const scopes = input
    .split(/[,\s]+/g)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0 && scope !== "delete_repo")
  return scopes.length === 0 ? defaultGithubScopes.split(",") : scopes
}

const withEnvContext = <A, E>(
  envGlobalPath: string,
  run: (context: EnvContext) => Effect.Effect<A, E, FileSystem.FileSystem>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureGithubOrchLayout(cwd, envGlobalPath))
      const envPath = resolvePathFromCwd(path, cwd, envGlobalPath)
      const current = yield* _(readEnvText(fs, envPath))
      return yield* _(run({ fs, envPath, current }))
    })
  )

const resolveGithubTokenFromGh = (
  cwd: string,
  accountPath: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuthCapture(
    buildDockerAuthSpec({
      cwd,
      image: ghImageName,
      hostPath: accountPath,
      containerPath: ghAuthDir,
      args: ["auth", "token"],
      interactive: false
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: "gh auth token", exitCode })
  ).pipe(
    Effect.map((raw) => raw.trim()),
    Effect.filterOrFail(
      (value) => value.length > 0,
      () => new CommandFailedError({ command: "gh auth token", exitCode: 1 })
    )
  )

const runGithubLogin = (
  cwd: string,
  accountPath: string,
  scopes: ReadonlyArray<string>
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuth(
    buildDockerAuthSpec({
      cwd,
      image: ghImageName,
      hostPath: accountPath,
      containerPath: ghAuthDir,
      env: "BROWSER=echo",
      args: [
        "auth",
        "login",
        "--web",
        "-h",
        "github.com",
        "-p",
        "https",
        ...(scopes.length > 0 ? ["--scopes", scopes.join(",")] : [])
      ],
      interactive: false
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: "gh auth login --web", exitCode })
  )

const retryGithubLogin = (
  effect: Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor>
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  effect.pipe(
    Effect.tapError(() => Effect.logWarning("GH auth login failed; retrying...")),
    Effect.retry(
      Schedule.addDelay(
        Schedule.recurs(2),
        () => Duration.seconds(2)
      )
    )
  )

const persistGithubToken = (
  fs: FileSystem.FileSystem,
  envPath: string,
  key: string,
  token: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const current = yield* _(readEnvText(fs, envPath))
    const nextText = upsertEnvKey(current, key, token)
    yield* _(fs.writeFileString(envPath, nextText))
    const label = labelFromKey(key)
    yield* _(Effect.log(`GitHub token stored (${label}) in ${envPath}`))
  })

const runGithubInteractiveLogin = (
  cwd: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
  envPath: string,
  command: AuthGithubLoginCommand
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, GithubRuntime> =>
  Effect.gen(function*(_) {
    const rootPath = resolvePathFromCwd(path, cwd, ghAuthRoot)
    const accountLabel = normalizeAccountLabel(command.label, "default")
    const accountPath = path.join(rootPath, accountLabel)
    const scopes = normalizeGithubScopes(command.scopes)
    yield* _(fs.makeDirectory(accountPath, { recursive: true }))
    yield* _(
      ensureDockerImage(fs, path, cwd, {
        imageName: ghImageName,
        imageDir: ghImageDir,
        dockerfile: renderGhDockerfile(),
        buildLabel: "gh auth"
      })
    )
    yield* _(Effect.log(`Starting GH auth login in container (scopes: ${scopes.join(", ")})...`))
    yield* _(retryGithubLogin(runGithubLogin(cwd, accountPath, scopes)))
    const resolved = yield* _(resolveGithubTokenFromGh(cwd, accountPath))
    yield* _(ensureEnvFile(fs, path, envPath))
    const key = buildGithubTokenKey(command.label)
    yield* _(persistGithubToken(fs, envPath, key, resolved))
  })

// CHANGE: login to GitHub by persisting a token in the shared env file
// WHY: make GH_TOKEN available to all docker-git projects
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall t: login(t) -> env(GITHUB_TOKEN)=t
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: token is never logged
// COMPLEXITY: O(n) where n = |env|
export const authGithubLogin = (
  command: AuthGithubLoginCommand
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, GithubRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureGithubOrchLayout(cwd, command.envGlobalPath))
      const envPath = resolvePathFromCwd(path, cwd, command.envGlobalPath)
      const token = command.token?.trim() ?? ""
      if (token.length > 0) {
        yield* _(ensureEnvFile(fs, path, envPath))
        const key = buildGithubTokenKey(command.label)
        yield* _(persistGithubToken(fs, envPath, key, token))
        return
      }
      return yield* _(runGithubInteractiveLogin(cwd, fs, path, envPath, command))
    })
  )

// CHANGE: show GitHub auth status from the shared env file
// WHY: surface current account labels without leaking tokens
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall env: status(env) -> labels(env)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: tokens are never logged
// COMPLEXITY: O(n) where n = |env|
export const authGithubStatus = (
  command: AuthGithubStatusCommand
): Effect.Effect<void, PlatformError, GithubFsRuntime> =>
  withEnvContext(command.envGlobalPath, ({ current, envPath }) =>
    Effect.gen(function*(_) {
      const tokens = listGithubTokens(current)
      if (tokens.length === 0) {
        yield* _(Effect.log(`GitHub not connected (no tokens in ${envPath}).`))
        return
      }
      const labels = tokens.map((entry) => entry.label).join(", ")
      yield* _(Effect.log(`GitHub tokens: ${labels}`))
    }))

// CHANGE: remove GitHub auth token from the shared env file
// WHY: allow revoking tokens without editing files manually
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall env: logout(env) -> !hasToken(env)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: only the selected token key is removed
// COMPLEXITY: O(n) where n = |env|
export const authGithubLogout = (
  command: AuthGithubLogoutCommand
): Effect.Effect<void, PlatformError, GithubFsRuntime> =>
  withEnvContext(command.envGlobalPath, ({ current, envPath, fs }) =>
    Effect.gen(function*(_) {
      const key = buildGithubTokenKey(command.label)
      const nextText = removeEnvKey(current, key)
      yield* _(fs.writeFileString(envPath, nextText))
      const label = labelFromKey(key)
      yield* _(Effect.log(`GitHub token removed (${label}) from ${envPath}`))
    }))
