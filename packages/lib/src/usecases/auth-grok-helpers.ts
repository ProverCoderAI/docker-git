import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { AuthGrokLoginCommand, AuthGrokLogoutCommand, AuthGrokStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import { runCommandExitCode } from "../shell/command-runner.js"
import { CommandFailedError } from "../shell/errors.js"
import { hasGrokAuthJsonCredentialText, hasGrokUserSettingsCredentialText } from "./auth-grok-credential-text.js"
import { isRegularFile, normalizeAccountLabel } from "./auth-helpers.js"
import { migrateLegacyOrchLayout } from "./auth-sync.js"
import { ensureDockerImage } from "./docker-image.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"

export type GrokRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
export type GrokAuthMethod = "none" | "api-key" | "oauth"

export const grokImageName = "docker-git-auth-grok:latest"
export const grokImageDir = ".docker-git/.orch/auth/grok/.image"
export const grokContainerHomeDir = "/grok-home"
export const grokCredentialsDir = ".grok"
export const grokCliInstallScriptUrl = "https://x.ai/cli/install.sh"
export const grokCliVersion = "0.1.211"

export type GrokAccountContext = {
  readonly accountLabel: string
  readonly accountPath: string
  readonly cwd: string
  readonly fs: FileSystem.FileSystem
}

export const grokAuthRoot = ".docker-git/.orch/auth/grok"

export const grokApiKeyFileName = ".api-key"
export const grokEnvFileName = ".env"

export const grokApiKeyPath = (accountPath: string): string => `${accountPath}/${grokApiKeyFileName}`
export const grokEnvFilePath = (accountPath: string): string => `${accountPath}/${grokEnvFileName}`
export const grokCredentialsPath = (accountPath: string): string => `${accountPath}/${grokCredentialsDir}`
export const grokUserSettingsPath = (accountPath: string): string =>
  `${grokCredentialsPath(accountPath)}/user-settings.json`
export const grokAuthJsonPath = (accountPath: string): string => `${grokCredentialsPath(accountPath)}/auth.json`

const grokEnvApiKeyNames: ReadonlyArray<string> = ["GROK_DEPLOYMENT_KEY", "GROK_API_KEY", "XAI_API_KEY"]

// CHANGE: render Dockerfile for Grok CLI authentication image
// WHY: Grok browser/OAuth auth must run in an isolated shell that persists ~/.grok
// QUOTE(ТЗ): "Signing in with Grok..."
// REF: issue-304
// SOURCE: https://x.ai/news/grok-build-cli
// FORMAT THEOREM: renderGrokDockerfile() -> valid_dockerfile
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: image includes the official xAI grok executable
// COMPLEXITY: O(1)
export const renderGrokDockerfile = (): string =>
  String.raw`FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bsdutils \
  && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 ${grokCliInstallScriptUrl} -o /tmp/grok-install.sh; \
  HOME=/tmp/grok-install-home GROK_BIN_DIR=/usr/local/bin bash /tmp/grok-install.sh ${grokCliVersion}; \
  install -m 0755 "$(readlink -f /usr/local/bin/grok)" /usr/local/bin/grok.real; \
  install -m 0755 "$(readlink -f /usr/local/bin/agent)" /usr/local/bin/agent.real; \
  mv -f /usr/local/bin/grok.real /usr/local/bin/grok; \
  mv -f /usr/local/bin/agent.real /usr/local/bin/agent; \
  rm -rf /tmp/grok-install.sh /tmp/grok-install-home
RUN grok --version
`

export const ensureGrokOrchLayout = (
  cwd: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath: defaultTemplateConfig.envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath: defaultTemplateConfig.codexAuthPath,
    ghAuthPath: ".docker-git/.orch/auth/gh",
    claudeAuthPath: ".docker-git/.orch/auth/claude",
    geminiAuthPath: ".docker-git/.orch/auth/gemini",
    grokAuthPath: ".docker-git/.orch/auth/grok"
  })

export const resolveGrokAccountPath = (path: Path.Path, rootPath: string, label: string | null): {
  readonly accountLabel: string
  readonly accountPath: string
} => {
  const accountLabel = normalizeAccountLabel(label, "default")
  const accountPath = path.join(rootPath, accountLabel)
  return { accountLabel, accountPath }
}

export const withGrokAuth = <A, E>(
  command: AuthGrokLoginCommand | AuthGrokLogoutCommand | AuthGrokStatusCommand,
  run: (
    context: GrokAccountContext
  ) => Effect.Effect<A, E, CommandExecutor.CommandExecutor>,
  options: { readonly buildImage?: boolean } = {}
): Effect.Effect<A, E | PlatformError | CommandFailedError, GrokRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureGrokOrchLayout(cwd))
      const rootPath = resolvePathFromCwd(path, cwd, command.grokAuthPath)
      const { accountLabel, accountPath } = resolveGrokAccountPath(path, rootPath, command.label)
      yield* _(fs.makeDirectory(accountPath, { recursive: true }))
      yield* _(fs.chmod(accountPath, 0o700))
      if (options.buildImage === true) {
        yield* _(
          ensureDockerImage(fs, path, cwd, {
            imageName: grokImageName,
            imageDir: grokImageDir,
            dockerfile: renderGrokDockerfile(),
            buildLabel: "grok auth"
          })
        )
      }
      return yield* _(run({ accountLabel, accountPath, cwd, fs }))
    })
  )

const readApiKeyFromEnvFile = (
  fs: FileSystem.FileSystem,
  envFilePath: string
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    const hasEnvFile = yield* _(isRegularFile(fs, envFilePath))
    if (!hasEnvFile) {
      return null
    }
    const envContent = yield* _(fs.readFileString(envFilePath), Effect.orElseSucceed(() => ""))
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim()
      for (const key of grokEnvApiKeyNames) {
        const prefix = `${key}=`
        if (!trimmed.startsWith(prefix)) {
          continue
        }
        const value = trimmed.slice(prefix.length).replaceAll(/^['"]|['"]$/g, "").trim()
        if (value.length > 0) {
          return value
        }
      }
    }
    return null
  })

export const readGrokApiKey = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    const apiKeyFilePath = grokApiKeyPath(accountPath)
    const hasApiKey = yield* _(isRegularFile(fs, apiKeyFilePath))
    if (hasApiKey) {
      const apiKey = yield* _(fs.readFileString(apiKeyFilePath), Effect.orElseSucceed(() => ""))
      const trimmed = apiKey.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }

    return yield* _(readApiKeyFromEnvFile(fs, grokEnvFilePath(accountPath)))
  })

export const hasGrokCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const apiKey = yield* _(readGrokApiKey(fs, accountPath))
    if (apiKey !== null) {
      return true
    }
    const hasAuthJson = yield* _(isRegularFile(fs, grokAuthJsonPath(accountPath)))
    if (hasAuthJson) {
      const authJson = yield* _(fs.readFileString(grokAuthJsonPath(accountPath)), Effect.orElseSucceed(() => ""))
      if (hasGrokAuthJsonCredentialText(authJson)) {
        return true
      }
    }
    const hasUserSettings = yield* _(isRegularFile(fs, grokUserSettingsPath(accountPath)))
    if (!hasUserSettings) {
      return false
    }
    const content = yield* _(fs.readFileString(grokUserSettingsPath(accountPath)), Effect.orElseSucceed(() => ""))
    return hasGrokUserSettingsCredentialText(content)
  })

export const resolveGrokAuthMethod = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<GrokAuthMethod, PlatformError> =>
  Effect.gen(function*(_) {
    const apiKey = yield* _(readGrokApiKey(fs, accountPath))
    if (apiKey !== null) {
      return "api-key"
    }
    const hasUserSettings = yield* _(hasGrokCredentials(fs, accountPath))
    return hasUserSettings ? "oauth" : "none"
  })

export const prepareGrokCredentialsDir = (
  cwd: string,
  accountPath: string,
  fs: FileSystem.FileSystem
) =>
  Effect.gen(function*(_) {
    const credentialsDir = grokCredentialsPath(accountPath)
    const removeFallback = pipe(
      runCommandExitCode({
        cwd,
        command: "docker",
        args: ["run", "--rm", "-v", `${accountPath}:/target`, "alpine", "rm", "-rf", "/target/.grok"]
      }),
      Effect.flatMap((exitCode) =>
        exitCode === 0
          ? Effect.void
          : Effect.fail(new CommandFailedError({ command: "docker", exitCode }))
      )
    )

    yield* _(
      fs.remove(credentialsDir, { recursive: true, force: true }).pipe(
        Effect.orElse(() => removeFallback)
      )
    )
    yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
    yield* _(fs.chmod(credentialsDir, 0o700))
    return credentialsDir
  })

export const defaultGrokProjectSettings = {
  sandboxMode: "off",
  mcpServers: {
    playwright: {
      command: "browser-connection",
      args: [],
      trust: true
    }
  }
}

export const defaultGrokUserSettings = (apiKey: string | null) => ({
  ...(apiKey !== null && { apiKey }),
  sandboxMode: "off",
  confirmBeforeToolUse: false
})

export const writeInitialGrokSettings = (
  credentialsDir: string,
  fs: FileSystem.FileSystem,
  apiKey: string | null
) =>
  Effect.gen(function*(_) {
    const settingsPath = `${credentialsDir}/settings.json`
    yield* _(
      fs.writeFileString(
        settingsPath,
        JSON.stringify(defaultGrokProjectSettings, null, 2) + "\n"
      )
    )
    yield* _(fs.chmod(settingsPath, 0o600))

    const userSettingsPath = `${credentialsDir}/user-settings.json`
    const shouldWriteUserSettings = apiKey === null
      ? !(yield* _(isRegularFile(fs, userSettingsPath)))
      : true
    if (shouldWriteUserSettings) {
      yield* _(
        fs.writeFileString(
          userSettingsPath,
          JSON.stringify(defaultGrokUserSettings(apiKey), null, 2) + "\n"
        )
      )
      yield* _(fs.chmod(userSettingsPath, 0o600))
    }
    return settingsPath
  })
