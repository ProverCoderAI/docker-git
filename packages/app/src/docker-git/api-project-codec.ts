import { asObject, asString, type JsonValue } from "./api-json.js"

export type ApiProjectSummary = {
  readonly id: string
  readonly displayName: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly containerName?: string | undefined
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

export type ApiCreateProjectAccepted = {
  readonly accepted: true
  readonly projectId: string
  readonly cursor: number
}

type ProjectDetailFields = Omit<ApiProjectDetails, keyof ApiProjectSummary> & Pick<ApiProjectDetails, "containerName">
type RawProjectDetailFields = {
  readonly containerName: string | null
  readonly serviceName: string | null
  readonly sshUser: string | null
  readonly sshPort: number | null
  readonly targetDir: string | null
  readonly projectDir: string | null
  readonly sshCommand: string | null
  readonly authorizedKeysPath: string | null
  readonly authorizedKeysExists: boolean | null
  readonly envGlobalPath: string | null
  readonly envProjectPath: string | null
  readonly codexAuthPath: string | null
  readonly codexHome: string | null
}

const isProjectStatus = (
  value: string
): value is ApiProjectSummary["status"] => ["running", "stopped", "unknown"].includes(value)

const stringOrEmpty = (value: string | null): string => value ?? ""

const numberOrZero = (value: number | null): number => value ?? 0
const readNullableNumber = (value: JsonValue | undefined): number | null => typeof value === "number" ? value : null
const readRequiredNumber = (value: JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

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
  const containerName = asString(object["containerName"]) ?? undefined
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
    containerName,
    status: stringOrEmpty(status),
    statusLabel: stringOrEmpty(statusLabel),
    sshSessions: numberOrZero(sshSessions),
    startedAtIso,
    startedAtEpochMs
  }
}

const readRequiredProjectDetails = (
  object: ReturnType<typeof asObject>
): RawProjectDetailFields | null => {
  if (object === null) {
    return null
  }

  return {
    containerName: asString(object["containerName"]),
    serviceName: asString(object["serviceName"]),
    sshUser: asString(object["sshUser"]),
    sshPort: typeof object["sshPort"] === "number" ? object["sshPort"] : null,
    targetDir: asString(object["targetDir"]),
    projectDir: asString(object["projectDir"]),
    sshCommand: asString(object["sshCommand"]),
    authorizedKeysPath: asString(object["authorizedKeysPath"]),
    authorizedKeysExists: typeof object["authorizedKeysExists"] === "boolean"
      ? object["authorizedKeysExists"]
      : null,
    envGlobalPath: asString(object["envGlobalPath"]),
    envProjectPath: asString(object["envProjectPath"]),
    codexAuthPath: asString(object["codexAuthPath"]),
    codexHome: asString(object["codexHome"])
  }
}

const decodeRequiredProjectDetails = (
  object: ReturnType<typeof asObject>
): ProjectDetailFields | null => {
  const rawFields = readRequiredProjectDetails(object)

  if (rawFields === null || Object.values(rawFields).includes(null)) {
    return null
  }

  return {
    containerName: stringOrEmpty(rawFields.containerName),
    serviceName: stringOrEmpty(rawFields.serviceName),
    sshUser: stringOrEmpty(rawFields.sshUser),
    sshPort: numberOrZero(rawFields.sshPort),
    targetDir: stringOrEmpty(rawFields.targetDir),
    projectDir: stringOrEmpty(rawFields.projectDir),
    sshCommand: stringOrEmpty(rawFields.sshCommand),
    authorizedKeysPath: stringOrEmpty(rawFields.authorizedKeysPath),
    authorizedKeysExists: rawFields.authorizedKeysExists === true,
    envGlobalPath: stringOrEmpty(rawFields.envGlobalPath),
    envProjectPath: stringOrEmpty(rawFields.envProjectPath),
    codexAuthPath: stringOrEmpty(rawFields.codexAuthPath),
    codexHome: stringOrEmpty(rawFields.codexHome)
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
  decodeRequiredProjectDetails(asObject(value))

export const decodeProjectSummary = (value: JsonValue): ApiProjectSummary | null => readProjectSummaryFields(value)

export const decodeProjectDetails = (value: JsonValue): ApiProjectDetails | null => {
  const summary = readProjectSummaryFields(value)
  const details = readProjectDetailFields(value)
  return summary === null || details === null ? null : { ...summary, ...details }
}

export const decodeCreateProjectAccepted = (value: JsonValue): ApiCreateProjectAccepted | null => {
  const object = asObject(value)
  if (object === null || object["accepted"] !== true) {
    return null
  }

  const projectId = asString(object["projectId"])
  const cursor = readRequiredNumber(object["cursor"])
  return projectId === null || cursor === null
    ? null
    : {
      accepted: true,
      projectId,
      cursor
    }
}

export const renderProjectSummaryLine = (project: ApiProjectSummary): string =>
  `${project.displayName} [${project.statusLabel}] ${project.repoRef} ${project.repoUrl}`
