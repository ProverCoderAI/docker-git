import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { AgentMode, ParseError, TemplateConfig } from "../core/domain.js"
import { normalizeAccountLabel } from "./auth-helpers.js"
import { hasNonEmptyFile } from "./auth-sync-helpers.js"

const autoOptionError = (reason: string): ParseError => ({
  _tag: "InvalidOption",
  option: "--auto",
  reason
})

const isRegularFile = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return false
    }
    const info = yield* _(fs.stat(filePath))
    return info.type === "File"
  })

const hasCodexAuth = (
  fs: FileSystem.FileSystem,
  rootPath: string,
  label: string | undefined
): Effect.Effect<boolean, PlatformError> => {
  const normalized = normalizeAccountLabel(label ?? null, "default")
  const authPath = normalized === "default"
    ? `${rootPath}/auth.json`
    : `${rootPath}/${normalized}/auth.json`
  return hasNonEmptyFile(fs, authPath)
}

const resolveClaudeAccountPath = (rootPath: string, label: string | undefined): ReadonlyArray<string> => {
  const normalized = normalizeAccountLabel(label ?? null, "default")
  if (normalized !== "default") {
    return [`${rootPath}/${normalized}`]
  }
  return [rootPath, `${rootPath}/default`]
}

const hasClaudeAuth = (
  fs: FileSystem.FileSystem,
  rootPath: string,
  label: string | undefined
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    for (const accountPath of resolveClaudeAccountPath(rootPath, label)) {
      const oauthToken = yield* _(hasNonEmptyFile(fs, `${accountPath}/.oauth-token`))
      if (oauthToken) {
        return true
      }

      const credentials = yield* _(isRegularFile(fs, `${accountPath}/.credentials.json`))
      if (credentials) {
        return true
      }

      const nestedCredentials = yield* _(isRegularFile(fs, `${accountPath}/.claude/.credentials.json`))
      if (nestedCredentials) {
        return true
      }
    }

    return false
  })

const resolveClaudeRoot = (codexSharedAuthPath: string): string =>
  `${codexSharedAuthPath.slice(0, codexSharedAuthPath.lastIndexOf("/"))}/claude`

const resolveAvailableAgentAuth = (
  fs: FileSystem.FileSystem,
  config: Pick<TemplateConfig, "claudeAuthLabel" | "codexAuthLabel" | "codexSharedAuthPath">
): Effect.Effect<{ readonly claudeAvailable: boolean; readonly codexAvailable: boolean }, PlatformError> =>
  Effect.gen(function*(_) {
    const claudeAvailable = yield* _(
      hasClaudeAuth(fs, resolveClaudeRoot(config.codexSharedAuthPath), config.claudeAuthLabel)
    )
    const codexAvailable = yield* _(hasCodexAuth(fs, config.codexSharedAuthPath, config.codexAuthLabel))
    return { claudeAvailable, codexAvailable }
  })

const resolveExplicitAutoAgentMode = (
  available: { readonly claudeAvailable: boolean; readonly codexAvailable: boolean },
  mode: AgentMode | undefined
): Effect.Effect<AgentMode | undefined, ParseError> => {
  if (mode === "claude") {
    return available.claudeAvailable
      ? Effect.succeed("claude")
      : Effect.fail(autoOptionError("Claude auth not found"))
  }
  if (mode === "codex") {
    return available.codexAvailable
      ? Effect.succeed("codex")
      : Effect.fail(autoOptionError("Codex auth not found"))
  }
  return Effect.sync(() => mode)
}

const pickRandomAutoAgentMode = (
  available: { readonly claudeAvailable: boolean; readonly codexAvailable: boolean }
): Effect.Effect<AgentMode, ParseError> => {
  if (!available.claudeAvailable && !available.codexAvailable) {
    return Effect.fail(autoOptionError("no Claude or Codex auth found"))
  }
  if (available.claudeAvailable && !available.codexAvailable) {
    return Effect.succeed("claude")
  }
  if (!available.claudeAvailable && available.codexAvailable) {
    return Effect.succeed("codex")
  }
  return Effect.sync(() => (process.hrtime.bigint() % 2n === 0n ? "claude" : "codex"))
}

export const resolveAutoAgentMode = (
  config: Pick<TemplateConfig, "agentAuto" | "agentMode" | "claudeAuthLabel" | "codexAuthLabel" | "codexSharedAuthPath">
): Effect.Effect<AgentMode | undefined, ParseError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)

    if (config.agentAuto !== true) {
      return config.agentMode
    }

    const available = yield* _(resolveAvailableAgentAuth(fs, config))
    const explicitMode = yield* _(resolveExplicitAutoAgentMode(available, config.agentMode))
    if (explicitMode !== undefined) {
      return explicitMode
    }

    return yield* _(pickRandomAutoAgentMode(available))
  })
