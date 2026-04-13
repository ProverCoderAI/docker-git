import { asObject, asString, type JsonValue } from "./api-json.js"
import type { AuthSnapshot, ProjectAuthSnapshot } from "./menu-types.js"

type RawAuthSnapshot = {
  readonly globalEnvPath: string | null
  readonly claudeAuthPath: string | null
  readonly geminiAuthPath: string | null
  readonly totalEntries: number | null
  readonly githubTokenEntries: number | null
  readonly gitTokenEntries: number | null
  readonly gitUserEntries: number | null
  readonly claudeAuthEntries: number | null
  readonly geminiAuthEntries: number | null
}

type RawProjectAuthSnapshot = {
  readonly projectDir: string | null
  readonly projectName: string | null
  readonly envGlobalPath: string | null
  readonly envProjectPath: string | null
  readonly claudeAuthPath: string | null
  readonly geminiAuthPath: string | null
  readonly githubTokenEntries: number | null
  readonly gitTokenEntries: number | null
  readonly claudeAuthEntries: number | null
  readonly geminiAuthEntries: number | null
  readonly activeGithubLabel: string | null
  readonly activeGitLabel: string | null
  readonly activeClaudeLabel: string | null
  readonly activeGeminiLabel: string | null
}

const readNumber = (value: JsonValue | undefined): number | null => typeof value === "number" ? value : null
const stringOrEmpty = (value: string | null): string => value ?? ""
const numberOrZero = (value: number | null): number => value ?? 0
const hasNullValue = (
  values: ReadonlyArray<string | number | null>
): boolean => values.includes(null)

const resolveSnapshotObject = (payload: JsonValue) => {
  const object = asObject(payload)
  return asObject(object?.["snapshot"] ?? payload)
}

const readAuthSnapshot = (
  snapshot: ReturnType<typeof resolveSnapshotObject>
): RawAuthSnapshot | null => {
  if (snapshot === null) {
    return null
  }

  return {
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
}

const decodeRequiredAuthSnapshot = (snapshot: RawAuthSnapshot): AuthSnapshot | null => {
  if (hasNullValue(Object.values(snapshot))) {
    return null
  }

  return {
    globalEnvPath: stringOrEmpty(snapshot.globalEnvPath),
    claudeAuthPath: stringOrEmpty(snapshot.claudeAuthPath),
    geminiAuthPath: stringOrEmpty(snapshot.geminiAuthPath),
    totalEntries: numberOrZero(snapshot.totalEntries),
    githubTokenEntries: numberOrZero(snapshot.githubTokenEntries),
    gitTokenEntries: numberOrZero(snapshot.gitTokenEntries),
    gitUserEntries: numberOrZero(snapshot.gitUserEntries),
    claudeAuthEntries: numberOrZero(snapshot.claudeAuthEntries),
    geminiAuthEntries: numberOrZero(snapshot.geminiAuthEntries)
  }
}

const readProjectAuthSnapshot = (
  snapshot: ReturnType<typeof resolveSnapshotObject>
): RawProjectAuthSnapshot | null => {
  if (snapshot === null) {
    return null
  }

  return {
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
}

const decodeRequiredProjectAuthSnapshot = (
  snapshot: RawProjectAuthSnapshot
): ProjectAuthSnapshot | null => {
  const requiredValues = [
    snapshot.projectDir,
    snapshot.projectName,
    snapshot.envGlobalPath,
    snapshot.envProjectPath,
    snapshot.claudeAuthPath,
    snapshot.geminiAuthPath,
    snapshot.githubTokenEntries,
    snapshot.gitTokenEntries,
    snapshot.claudeAuthEntries,
    snapshot.geminiAuthEntries
  ]

  if (hasNullValue(requiredValues)) {
    return null
  }

  return {
    projectDir: stringOrEmpty(snapshot.projectDir),
    projectName: stringOrEmpty(snapshot.projectName),
    envGlobalPath: stringOrEmpty(snapshot.envGlobalPath),
    envProjectPath: stringOrEmpty(snapshot.envProjectPath),
    claudeAuthPath: stringOrEmpty(snapshot.claudeAuthPath),
    geminiAuthPath: stringOrEmpty(snapshot.geminiAuthPath),
    githubTokenEntries: numberOrZero(snapshot.githubTokenEntries),
    gitTokenEntries: numberOrZero(snapshot.gitTokenEntries),
    claudeAuthEntries: numberOrZero(snapshot.claudeAuthEntries),
    geminiAuthEntries: numberOrZero(snapshot.geminiAuthEntries),
    activeGithubLabel: snapshot.activeGithubLabel,
    activeGitLabel: snapshot.activeGitLabel,
    activeClaudeLabel: snapshot.activeClaudeLabel,
    activeGeminiLabel: snapshot.activeGeminiLabel
  }
}

export const decodeAuthSnapshot = (payload: JsonValue): AuthSnapshot | null => {
  const snapshot = readAuthSnapshot(resolveSnapshotObject(payload))
  return snapshot === null ? null : decodeRequiredAuthSnapshot(snapshot)
}

export const decodeProjectAuthSnapshot = (
  payload: JsonValue
): ProjectAuthSnapshot | null => {
  const snapshot = readProjectAuthSnapshot(resolveSnapshotObject(payload))
  return snapshot === null ? null : decodeRequiredProjectAuthSnapshot(snapshot)
}
