import { asObject, asString, type JsonValue } from "./api-json.js"

export type ProjectEventLineSource = {
  readonly payload: JsonValue | undefined
  readonly type: string
}

const readProjectEventPayloadField = (
  payload: JsonValue | undefined,
  key: string
): string | null => {
  const object = asObject(payload)
  return object === null ? null : asString(object[key])
}

const formatProjectStatusLine = (payload: JsonValue | undefined): string | null => {
  const phase = readProjectEventPayloadField(payload, "phase")
  const message = readProjectEventPayloadField(payload, "message")
  if (message === null) {
    return null
  }
  return phase === null ? message : `[${phase}] ${message}`
}

const formatProjectSshLine = (payload: JsonValue | undefined): string | null => {
  const phase = readProjectEventPayloadField(payload, "phase")
  const sessionId = readProjectEventPayloadField(payload, "sessionId")
  if (phase === null) {
    return null
  }
  return sessionId === null ? `[ssh] ${phase}` : `[ssh] ${phase} (${sessionId})`
}

export const formatProjectEventLine = (event: ProjectEventLineSource): string | null => {
  if (event.type === "project.deployment.status") {
    return formatProjectStatusLine(event.payload)
  }

  if (event.type === "project.deployment.log") {
    return readProjectEventPayloadField(event.payload, "line")
  }

  if (event.type === "project.ssh.session") {
    return formatProjectSshLine(event.payload)
  }

  return null
}
