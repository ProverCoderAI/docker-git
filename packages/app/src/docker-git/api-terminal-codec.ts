import type { TerminalSession } from "../shared/terminal-session-schema.js"
import { asObject, asString, type JsonValue } from "./api-json.js"

export type ApiTerminalSession = TerminalSession

type RawTerminalSession = {
  readonly id: string | null
  readonly projectId: string | null
  readonly sshCommand: string | null
  readonly status: string | null
  readonly createdAt: string | null
  readonly startedAt: string | undefined
  readonly closedAt: string | undefined
  readonly exitCode: number | undefined
  readonly signal: number | undefined
}

const isTerminalSessionStatus = (
  value: string
): value is ApiTerminalSession["status"] =>
  value === "ready" || value === "attached" || value === "exited" || value === "failed"

const readOptionalNumber = (value: JsonValue | undefined): number | undefined =>
  typeof value === "number" ? value : undefined

const readTerminalSession = (payload: JsonValue): RawTerminalSession | null => {
  const object = asObject(payload)
  if (object === null) {
    return null
  }

  return {
    id: asString(object["id"]),
    projectId: asString(object["projectId"]),
    sshCommand: asString(object["sshCommand"]),
    status: asString(object["status"]),
    createdAt: asString(object["createdAt"]),
    startedAt: asString(object["startedAt"]) ?? undefined,
    closedAt: asString(object["closedAt"]) ?? undefined,
    exitCode: readOptionalNumber(object["exitCode"]),
    signal: readOptionalNumber(object["signal"])
  }
}

export const decodeTerminalSession = (payload: JsonValue): ApiTerminalSession | null => {
  const session = readTerminalSession(payload)
  if (session === null) {
    return null
  }

  if (
    session.id === null ||
    session.projectId === null ||
    session.sshCommand === null ||
    session.createdAt === null ||
    session.status === null ||
    !isTerminalSessionStatus(session.status)
  ) {
    return null
  }

  return {
    ...session,
    id: session.id,
    projectId: session.projectId,
    sshCommand: session.sshCommand,
    status: session.status,
    createdAt: session.createdAt
  }
}
