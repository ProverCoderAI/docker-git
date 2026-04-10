import { asObject, asString, type JsonValue } from "./api-json.js"

export type ApiProjectSummary = {
  readonly id: string
  readonly displayName: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly status: "running" | "stopped" | "unknown"
  readonly statusLabel: string
  readonly sshSessions: number
  readonly startedAtIso: string | null
  readonly startedAtEpochMs: number | null
  readonly clonedOnHostname?: string | undefined
}

export type ApiProjectDetails = ApiProjectSummary & {
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly targetDir: string
  readonly projectDir: string
  readonly sshCommand: string
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
}

type ProjectDetailFields = Omit<ApiProjectDetails, keyof ApiProjectSummary>

const isProjectStatus = (
  value: string
): value is ApiProjectSummary["status"] => value === "running" || value === "stopped" || value === "unknown"

const stringOrEmpty = (value: string | null): string => value ?? ""

const numberOrZero = (value: number | null): number => value ?? 0
const readNullableNumber = (value: JsonValue | undefined): number | null =>
  typeof value === "number" ? value : value === null ? null : null

const readSummaryBaseFields = (
  object: ReturnType<typeof asObject>
): Omit<ApiProjectSummary, "status"> & { readonly status: string } | null => {
  if (object === null) {
    return null
  }

  const id = asString(object["id"])
  const displayName = asString(object["displayName"])
  const repoUrl = asString(object["repoUrl"])
  const repoRef = asString(object["repoRef"])
  const status = asString(object["status"])
  const statusLabel = asString(object["statusLabel"])
  const sshSessions = typeof object["sshSessions"] === "number" ? object["sshSessions"] : null
  const startedAtIso = object["startedAtIso"] === null ? null : asString(object["startedAtIso"])
  const startedAtEpochMs = readNullableNumber(object["startedAtEpochMs"])
  const values = [id, displayName, repoUrl, repoRef, status, statusLabel, sshSessions]

  if (values.includes(null)) {
    return null
  }

  return {
    id: stringOrEmpty(id),
    displayName: stringOrEmpty(displayName),
    repoUrl: stringOrEmpty(repoUrl),
    repoRef: stringOrEmpty(repoRef),
    status: stringOrEmpty(status),
    statusLabel: stringOrEmpty(statusLabel),
    sshSessions: numberOrZero(sshSessions),
    startedAtIso,
    startedAtEpochMs
  }
}

const readRequiredProjectDetails = (
  object: ReturnType<typeof asObject>
): ProjectDetailFields | null => {
  if (object === null) {
    return null
  }

  const containerName = asString(object["containerName"])
  const serviceName = asString(object["serviceName"])
  const sshUser = asString(object["sshUser"])
  const sshPort = typeof object["sshPort"] === "number" ? object["sshPort"] : null
  const targetDir = asString(object["targetDir"])
  const projectDir = asString(object["projectDir"])
  const sshCommand = asString(object["sshCommand"])
  const authorizedKeysPath = asString(object["authorizedKeysPath"])
  const authorizedKeysExists = typeof object["authorizedKeysExists"] === "boolean"
    ? object["authorizedKeysExists"]
    : null
  const envGlobalPath = asString(object["envGlobalPath"])
  const envProjectPath = asString(object["envProjectPath"])
  const codexAuthPath = asString(object["codexAuthPath"])
  const codexHome = asString(object["codexHome"])
  const values = [containerName, serviceName, sshUser, sshPort, targetDir, projectDir, sshCommand, authorizedKeysPath, authorizedKeysExists, envGlobalPath, envProjectPath, codexAuthPath, codexHome]

  if (values.includes(null)) {
    return null
  }

  return {
    containerName: stringOrEmpty(containerName),
    serviceName: stringOrEmpty(serviceName),
    sshUser: stringOrEmpty(sshUser),
    sshPort: numberOrZero(sshPort),
    targetDir: stringOrEmpty(targetDir),
    projectDir: stringOrEmpty(projectDir),
    sshCommand: stringOrEmpty(sshCommand),
    authorizedKeysPath: stringOrEmpty(authorizedKeysPath),
    authorizedKeysExists: authorizedKeysExists === true,
    envGlobalPath: stringOrEmpty(envGlobalPath),
    envProjectPath: stringOrEmpty(envProjectPath),
    codexAuthPath: stringOrEmpty(codexAuthPath),
    codexHome: stringOrEmpty(codexHome)
  }
}

const readProjectSummaryFields = (value: JsonValue): ApiProjectSummary | null => {
  const object = asObject(value)
  const summary = readSummaryBaseFields(object)
  if (summary === null || !isProjectStatus(summary.status)) {
    return null
  }
  return {
    ...summary,
    status: summary.status
  }
}

const readProjectDetailFields = (value: JsonValue): ProjectDetailFields | null =>
  readRequiredProjectDetails(asObject(value))

export const decodeProjectSummary = (value: JsonValue): ApiProjectSummary | null => readProjectSummaryFields(value)

export const decodeProjectDetails = (value: JsonValue): ApiProjectDetails | null => {
  const summary = readProjectSummaryFields(value)
  const details = readProjectDetailFields(value)
  return summary === null || details === null ? null : { ...summary, ...details }
}

export const renderProjectSummaryLine = (project: ApiProjectSummary): string =>
  `${project.displayName} [${project.statusLabel}] ${project.repoRef} ${project.repoUrl}`
