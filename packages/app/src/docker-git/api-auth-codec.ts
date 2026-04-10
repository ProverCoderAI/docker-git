import { asObject, asString, type JsonValue } from "./api-json.js"
import type { AuthSnapshot, ProjectAuthSnapshot } from "./menu-types.js"

const readNumber = (value: JsonValue | undefined): number | null =>
  typeof value === "number" ? value : null

const resolveSnapshotObject = (payload: JsonValue) => {
  const object = asObject(payload)
  return asObject(object?.["snapshot"] ?? payload)
}

export const decodeAuthSnapshot = (payload: JsonValue): AuthSnapshot | null => {
  const snapshot = resolveSnapshotObject(payload)
  if (snapshot === null) {
    return null
  }

  const decoded = {
    globalEnvPath: asString(snapshot["globalEnvPath"]),
    claudeAuthPath: asString(snapshot["claudeAuthPath"]),
    geminiAuthPath: asString(snapshot["geminiAuthPath"]),
    totalEntries: readNumber(snapshot["totalEntries"]),
    githubTokenEntries: readNumber(snapshot["githubTokenEntries"]),
    gitTokenEntries: readNumber(snapshot["gitTokenEntries"]),
    gitUserEntries: readNumber(snapshot["gitUserEntries"]),
    claudeAuthEntries: readNumber(snapshot["claudeAuthEntries"]),
    geminiAuthEntries: readNumber(snapshot["geminiAuthEntries"])
  }

  return Object.values(decoded).includes(null)
    ? null
    : {
      globalEnvPath: decoded.globalEnvPath ?? "",
      claudeAuthPath: decoded.claudeAuthPath ?? "",
      geminiAuthPath: decoded.geminiAuthPath ?? "",
      totalEntries: decoded.totalEntries ?? 0,
      githubTokenEntries: decoded.githubTokenEntries ?? 0,
      gitTokenEntries: decoded.gitTokenEntries ?? 0,
      gitUserEntries: decoded.gitUserEntries ?? 0,
      claudeAuthEntries: decoded.claudeAuthEntries ?? 0,
      geminiAuthEntries: decoded.geminiAuthEntries ?? 0
    }
}

export const decodeProjectAuthSnapshot = (payload: JsonValue): ProjectAuthSnapshot | null => {
  const snapshot = resolveSnapshotObject(payload)
  if (snapshot === null) {
    return null
  }

  const decoded = {
    projectDir: asString(snapshot["projectDir"]),
    projectName: asString(snapshot["projectName"]),
    envGlobalPath: asString(snapshot["envGlobalPath"]),
    envProjectPath: asString(snapshot["envProjectPath"]),
    claudeAuthPath: asString(snapshot["claudeAuthPath"]),
    geminiAuthPath: asString(snapshot["geminiAuthPath"]),
    githubTokenEntries: readNumber(snapshot["githubTokenEntries"]),
    gitTokenEntries: readNumber(snapshot["gitTokenEntries"]),
    claudeAuthEntries: readNumber(snapshot["claudeAuthEntries"]),
    geminiAuthEntries: readNumber(snapshot["geminiAuthEntries"]),
    activeGithubLabel: asString(snapshot["activeGithubLabel"]),
    activeGitLabel: asString(snapshot["activeGitLabel"]),
    activeClaudeLabel: asString(snapshot["activeClaudeLabel"]),
    activeGeminiLabel: asString(snapshot["activeGeminiLabel"])
  }

  const requiredValues = [
    decoded.projectDir,
    decoded.projectName,
    decoded.envGlobalPath,
    decoded.envProjectPath,
    decoded.claudeAuthPath,
    decoded.geminiAuthPath,
    decoded.githubTokenEntries,
    decoded.gitTokenEntries,
    decoded.claudeAuthEntries,
    decoded.geminiAuthEntries
  ]
  if (requiredValues.includes(null)) {
    return null
  }

  return {
    projectDir: decoded.projectDir ?? "",
    projectName: decoded.projectName ?? "",
    envGlobalPath: decoded.envGlobalPath ?? "",
    envProjectPath: decoded.envProjectPath ?? "",
    claudeAuthPath: decoded.claudeAuthPath ?? "",
    geminiAuthPath: decoded.geminiAuthPath ?? "",
    githubTokenEntries: decoded.githubTokenEntries ?? 0,
    gitTokenEntries: decoded.gitTokenEntries ?? 0,
    claudeAuthEntries: decoded.claudeAuthEntries ?? 0,
    geminiAuthEntries: decoded.geminiAuthEntries ?? 0,
    activeGithubLabel: decoded.activeGithubLabel,
    activeGitLabel: decoded.activeGitLabel,
    activeClaudeLabel: decoded.activeClaudeLabel,
    activeGeminiLabel: decoded.activeGeminiLabel
  }
}
