import { asObject, asString, type JsonValue } from "./api-json.js"
import type { AuthSnapshot, ProjectAuthSnapshot } from "./menu-types.js"

type RawAuthSnapshot = {
  readonly globalEnvPath: string | null
  readonly claudeAuthPath: string | null
  readonly codexAuthPath: string | null
  readonly geminiAuthPath: string | null
  readonly grokAuthPath: string | null
  readonly totalEntries: number | null
  readonly githubTokenEntries: number | null
  readonly gitTokenEntries: number | null
  readonly gitUserEntries: number | null
  readonly claudeAuthEntries: number | null
  readonly codexAuthEntries: number | null
  readonly geminiAuthEntries: number | null
  readonly grokAuthEntries: number | null
}

type RawProjectAuthSnapshot = {
  /* jscpd:ignore-start */
  readonly projectDir: string | null
  readonly projectName: string | null
  readonly envGlobalPath: string | null
  readonly envProjectPath: string | null
  readonly claudeAuthPath: string | null
  readonly geminiAuthPath: string | null
  readonly grokAuthPath: string | null
  readonly githubTokenEntries: number | null
  readonly gitTokenEntries: number | null
  readonly claudeAuthEntries: number | null
  readonly geminiAuthEntries: number | null
  readonly grokAuthEntries: number | null
  readonly activeGithubLabel: string | null
  readonly activeGitLabel: string | null
  readonly activeClaudeLabel: string | null
  readonly activeGeminiLabel: string | null
  readonly activeGrokLabel: string | null
  /* jscpd:ignore-end */
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
    codexAuthPath: asString(snapshot["codexAuthPath"]),
    geminiAuthPath: asString(snapshot["geminiAuthPath"]),
    grokAuthPath: asString(snapshot["grokAuthPath"]),
    totalEntries: readNumber(snapshot["totalEntries"]),
    githubTokenEntries: readNumber(snapshot["githubTokenEntries"]),
    gitTokenEntries: readNumber(snapshot["gitTokenEntries"]),
    gitUserEntries: readNumber(snapshot["gitUserEntries"]),
    claudeAuthEntries: readNumber(snapshot["claudeAuthEntries"]),
    codexAuthEntries: readNumber(snapshot["codexAuthEntries"]),
    geminiAuthEntries: readNumber(snapshot["geminiAuthEntries"]),
    grokAuthEntries: readNumber(snapshot["grokAuthEntries"])
  }
}

const decodeRequiredAuthSnapshot = (snapshot: RawAuthSnapshot): AuthSnapshot | null => {
  const requiredValues = [
    snapshot.globalEnvPath,
    snapshot.claudeAuthPath,
    snapshot.geminiAuthPath,
    snapshot.grokAuthPath,
    snapshot.totalEntries,
    snapshot.githubTokenEntries,
    snapshot.gitTokenEntries,
    snapshot.gitUserEntries,
    snapshot.claudeAuthEntries,
    snapshot.geminiAuthEntries,
    snapshot.grokAuthEntries
  ]
  if (hasNullValue(requiredValues)) {
    return null
  }

  return {
    globalEnvPath: stringOrEmpty(snapshot.globalEnvPath),
    claudeAuthPath: stringOrEmpty(snapshot.claudeAuthPath),
    codexAuthPath: stringOrEmpty(snapshot.codexAuthPath),
    geminiAuthPath: stringOrEmpty(snapshot.geminiAuthPath),
    grokAuthPath: stringOrEmpty(snapshot.grokAuthPath),
    totalEntries: numberOrZero(snapshot.totalEntries),
    githubTokenEntries: numberOrZero(snapshot.githubTokenEntries),
    gitTokenEntries: numberOrZero(snapshot.gitTokenEntries),
    gitUserEntries: numberOrZero(snapshot.gitUserEntries),
    claudeAuthEntries: numberOrZero(snapshot.claudeAuthEntries),
    codexAuthEntries: numberOrZero(snapshot.codexAuthEntries),
    geminiAuthEntries: numberOrZero(snapshot.geminiAuthEntries),
    grokAuthEntries: numberOrZero(snapshot.grokAuthEntries)
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
    grokAuthPath: asString(snapshot["grokAuthPath"]),
    githubTokenEntries: readNumber(snapshot["githubTokenEntries"]),
    gitTokenEntries: readNumber(snapshot["gitTokenEntries"]),
    claudeAuthEntries: readNumber(snapshot["claudeAuthEntries"]),
    geminiAuthEntries: readNumber(snapshot["geminiAuthEntries"]),
    grokAuthEntries: readNumber(snapshot["grokAuthEntries"]),
    activeGithubLabel: asString(snapshot["activeGithubLabel"]),
    activeGitLabel: asString(snapshot["activeGitLabel"]),
    activeClaudeLabel: asString(snapshot["activeClaudeLabel"]),
    activeGeminiLabel: asString(snapshot["activeGeminiLabel"]),
    activeGrokLabel: asString(snapshot["activeGrokLabel"])
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
    snapshot.grokAuthPath,
    snapshot.githubTokenEntries,
    snapshot.gitTokenEntries,
    snapshot.claudeAuthEntries,
    snapshot.geminiAuthEntries,
    snapshot.grokAuthEntries
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
    grokAuthPath: stringOrEmpty(snapshot.grokAuthPath),
    githubTokenEntries: numberOrZero(snapshot.githubTokenEntries),
    gitTokenEntries: numberOrZero(snapshot.gitTokenEntries),
    claudeAuthEntries: numberOrZero(snapshot.claudeAuthEntries),
    geminiAuthEntries: numberOrZero(snapshot.geminiAuthEntries),
    grokAuthEntries: numberOrZero(snapshot.grokAuthEntries),
    activeGithubLabel: snapshot.activeGithubLabel,
    activeGitLabel: snapshot.activeGitLabel,
    activeClaudeLabel: snapshot.activeClaudeLabel,
    activeGeminiLabel: snapshot.activeGeminiLabel,
    activeGrokLabel: snapshot.activeGrokLabel
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
