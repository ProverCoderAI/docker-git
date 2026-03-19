import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { AuthGeminiLoginCommand, AuthGeminiLogoutCommand, AuthGeminiStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import { runCommandExitCode } from "../shell/command-runner.js"
import type { CommandFailedError } from "../shell/errors.js"
import { isRegularFile, normalizeAccountLabel } from "./auth-helpers.js"
import { migrateLegacyOrchLayout } from "./auth-sync.js"
import { ensureDockerImage } from "./docker-image.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"

export type GeminiRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
export type GeminiAuthMethod = "none" | "api-key" | "oauth"

export const geminiImageName = "docker-git-auth-gemini:latest"
export const geminiImageDir = ".docker-git/.orch/auth/gemini/.image"
export const geminiContainerHomeDir = "/gemini-home"
export const geminiCredentialsDir = ".gemini"

export type GeminiAccountContext = {
  readonly accountLabel: string
  readonly accountPath: string
  readonly cwd: string
  readonly fs: FileSystem.FileSystem
}

export const geminiAuthRoot = ".docker-git/.orch/auth/gemini"

export const geminiApiKeyFileName = ".api-key"
export const geminiEnvFileName = ".env"

export const geminiApiKeyPath = (accountPath: string): string => `${accountPath}/${geminiApiKeyFileName}`
export const geminiEnvFilePath = (accountPath: string): string => `${accountPath}/${geminiEnvFileName}`
export const geminiCredentialsPath = (accountPath: string): string => `${accountPath}/${geminiCredentialsDir}`

// CHANGE: render Dockerfile for Gemini CLI authentication image
// WHY: Gemini CLI OAuth requires running in Docker for headless environments
// QUOTE(ТЗ): "Типо ждал пока мы вставим ссылку"
// REF: issue-146, PR-147 comment
// SOURCE: https://github.com/google-gemini/gemini-cli
// FORMAT THEOREM: renderGeminiDockerfile() -> valid_dockerfile
// PURITY: CORE
// INVARIANT: Image includes Node.js and Gemini CLI
// COMPLEXITY: O(1)
export const renderGeminiDockerfile = (): string =>
  String.raw`FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bsdutils \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @google/gemini-cli@0.33.2
`

export const ensureGeminiOrchLayout = (
  cwd: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath: defaultTemplateConfig.envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath: defaultTemplateConfig.codexAuthPath,
    ghAuthPath: ".docker-git/.orch/auth/gh",
    claudeAuthPath: ".docker-git/.orch/auth/claude",
    geminiAuthPath: ".docker-git/.orch/auth/gemini"
  })

export const resolveGeminiAccountPath = (path: Path.Path, rootPath: string, label: string | null): {
  readonly accountLabel: string
  readonly accountPath: string
} => {
  const accountLabel = normalizeAccountLabel(label, "default")
  const accountPath = path.join(rootPath, accountLabel)
  return { accountLabel, accountPath }
}

export const withGeminiAuth = <A, E>(
  command: AuthGeminiLoginCommand | AuthGeminiLogoutCommand | AuthGeminiStatusCommand,
  run: (
    context: GeminiAccountContext
  ) => Effect.Effect<A, E, CommandExecutor.CommandExecutor>,
  options: { readonly buildImage?: boolean } = {}
): Effect.Effect<A, E | PlatformError | CommandFailedError, GeminiRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureGeminiOrchLayout(cwd))
      const rootPath = resolvePathFromCwd(path, cwd, command.geminiAuthPath)
      const { accountLabel, accountPath } = resolveGeminiAccountPath(path, rootPath, command.label)
      yield* _(fs.makeDirectory(accountPath, { recursive: true }))
      if (options.buildImage === true) {
        yield* _(
          ensureDockerImage(fs, path, cwd, {
            imageName: geminiImageName,
            imageDir: geminiImageDir,
            dockerfile: renderGeminiDockerfile(),
            buildLabel: "gemini auth"
          })
        )
      }
      return yield* _(run({ accountLabel, accountPath, cwd, fs }))
    })
  )

export const readApiKey = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    const apiKeyFilePath = geminiApiKeyPath(accountPath)
    const hasApiKey = yield* _(isRegularFile(fs, apiKeyFilePath))
    if (hasApiKey) {
      const apiKey = yield* _(fs.readFileString(apiKeyFilePath), Effect.orElseSucceed(() => ""))
      const trimmed = apiKey.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }

    const envFilePath = geminiEnvFilePath(accountPath)
    const hasEnvFile = yield* _(isRegularFile(fs, envFilePath))
    if (hasEnvFile) {
      const envContent = yield* _(fs.readFileString(envFilePath), Effect.orElseSucceed(() => ""))
      const lines = envContent.split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith("GEMINI_API_KEY=")) {
          const value = trimmed.slice("GEMINI_API_KEY=".length).replaceAll(/^['"]|['"]$/g, "").trim()
          if (value.length > 0) {
            return value
          }
        }
      }
    }

    return null
  })

// CHANGE: check for OAuth credentials in .gemini directory
// WHY: Gemini CLI stores OAuth tokens in ~/.gemini after successful OAuth flow
// QUOTE(ТЗ): "Типо ждал пока мы вставим ссылку"
// REF: issue-146, PR-147 comment
// SOURCE: https://github.com/google-gemini/gemini-cli
// FORMAT THEOREM: hasOauthCredentials(fs, accountPath) -> boolean
// PURITY: SHELL
// INVARIANT: checks for existence of OAuth token file
// COMPLEXITY: O(1)
export const hasOauthCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const credentialsDir = geminiCredentialsPath(accountPath)
    const dirExists = yield* _(fs.exists(credentialsDir))
    if (!dirExists) {
      return false
    }
    // Check for various possible credential files Gemini CLI might create
    const possibleFiles = [
      `${credentialsDir}/oauth_creds.json`,
      `${credentialsDir}/oauth-tokens.json`,
      `${credentialsDir}/credentials.json`,
      `${credentialsDir}/application_default_credentials.json`
    ]
    for (const filePath of possibleFiles) {
      const fileExists = yield* _(isRegularFile(fs, filePath))
      if (fileExists) {
        return true
      }
    }
    return false
  })

// CHANGE: resolve Gemini authentication method
// WHY: need to detect whether user authenticated via API key or OAuth
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: resolveGeminiAuthMethod(fs, accountPath) -> GeminiAuthMethod
// PURITY: SHELL
// INVARIANT: API key takes precedence over OAuth credentials
// COMPLEXITY: O(1)
export const resolveGeminiAuthMethod = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<GeminiAuthMethod, PlatformError> =>
  Effect.gen(function*(_) {
    const apiKey = yield* _(readApiKey(fs, accountPath))
    if (apiKey !== null) {
      return "api-key"
    }

    const hasOauth = yield* _(hasOauthCredentials(fs, accountPath))
    return hasOauth ? "oauth" : "none"
  })

// CHANGE: login to Gemini CLI via OAuth in Docker container
// WHY: enable Gemini CLI OAuth authentication in headless/Docker environments
// QUOTE(ТЗ): "Мне надо что бы он её умел принимать, типо ждал пока мы вставим ссылку"
// REF: issue-146, PR-147 comment from skulidropek
// SOURCE: https://github.com/google-gemini/gemini-cli
export const prepareGeminiCredentialsDir = (
  cwd: string,
  accountPath: string,
  fs: FileSystem.FileSystem
) =>
  Effect.gen(function*(_) {
    const credentialsDir = geminiCredentialsPath(accountPath)
    const removeFallback = pipe(
      runCommandExitCode({
        cwd,
        command: "docker",
        args: ["run", "--rm", "-v", `${accountPath}:/target`, "alpine", "rm", "-rf", "/target/.gemini"]
      }),
      Effect.asVoid,
      Effect.orElse(() => Effect.void)
    )

    yield* _(
      fs.remove(credentialsDir, { recursive: true, force: true }).pipe(
        Effect.orElse(() => removeFallback)
      )
    )
    yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
    // Fix permissions before Docker starts, so root in container can write freely
    yield* _(
      runCommandExitCode({
        cwd,
        command: "chmod",
        args: ["-R", "777", credentialsDir]
      }).pipe(Effect.orElse(() => Effect.succeed(0)))
    )
    return credentialsDir
  })

export const defaultGeminiSettings = {
  model: {
    name: "gemini-3.1-pro-preview",
    compressionThreshold: 0.9,
    disableLoopDetection: true
  },
  modelConfigs: {
    customAliases: {
      "yolo-ultra": {
        "modelConfig": {
          "model": "gemini-3.1-pro-preview",
          "generateContentConfig": {
            "tools": [
              {
                "googleSearch": {}
              },
              {
                "urlContext": {}
              }
            ]
          }
        }
      }
    }
  },
  general: {
    defaultApprovalMode: "auto_edit"
  },
  tools: {
    allowed: [
      "run_shell_command",
      "write_file",
      "googleSearch",
      "urlContext"
    ]
  },
  sandbox: {
    enabled: false
  },
  security: {
    folderTrust: {
      enabled: false
    },
    auth: {
      selectedType: "oauth-personal"
    },
    disableYoloMode: false
  },
  mcpServers: {
    playwright: {
      command: "docker-git-playwright-mcp",
      args: [],
      trust: true
    }
  }
}

export const writeInitialSettings = (credentialsDir: string, fs: FileSystem.FileSystem) =>
  Effect.gen(function*(_) {
    const settingsPath = `${credentialsDir}/settings.json`
    yield* _(
      fs.writeFileString(
        settingsPath,
        JSON.stringify(defaultGeminiSettings, null, 2) + "\n"
      )
    )

    const trustedFoldersPath = `${credentialsDir}/trustedFolders.json`
    yield* _(
      fs.writeFileString(
        trustedFoldersPath,
        JSON.stringify({ "/": "TRUST_FOLDER", [geminiContainerHomeDir]: "TRUST_FOLDER" })
      )
    )
    return settingsPath
  })
