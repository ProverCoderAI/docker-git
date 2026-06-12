import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

import { JsonValueSchema } from "../shared/json-schema.js"
import type { JsonObject, JsonValue } from "../shared/json-schema.js"
import {
  deactivateTerminalWorkspaceState,
  emptyTerminalWorkspaceState,
  type TerminalWorkspaceState
} from "./terminal-state.js"
import type { ActiveTerminalSession } from "./terminal.js"

type StoredActiveTerminalSession =
  & Omit<ActiveTerminalSession, "onExit" | "onReady" | "pendingConnection">
  & {
    readonly pendingConnectionMessage?: string | undefined
    readonly pendingConnectionPhase?: NonNullable<ActiveTerminalSession["pendingConnection"]>["phase"] | undefined
  }

type StoredTerminalWorkspaceState = {
  readonly activeTerminalSessionId: string | null
  readonly savedAt: number
  readonly terminalSessions: ReadonlyArray<StoredActiveTerminalSession>
}

const terminalWorkspaceStorageKey = "docker-git.terminal-workspace.v1"
const JsonValueFromStringSchema: Schema.Schema<JsonValue, string> = Schema.parseJson(JsonValueSchema)

const isRecord = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readString = (value: JsonValue | undefined): string | null => typeof value === "string" ? value : null

const readOptionalString = (value: JsonValue | undefined): string | undefined => readString(value) ?? undefined

const readStoredActiveSessionId = (value: JsonValue | undefined): string | null | undefined =>
  value === null ? null : readString(value) ?? undefined

const readJsonArray = (value: JsonValue | undefined): ReadonlyArray<JsonValue> | null =>
  Array.isArray(value) ? value : null

const isStoredTerminalStatus = (
  value: string | null
): value is ActiveTerminalSession["session"]["status"] =>
  ["ready", "attached", "exited", "failed"].includes(value as string)

type StoredTerminalSessionFields = {
  readonly createdAt: string | null
  readonly id: string | null
  readonly projectId: string | null
  readonly sshCommand: string | null
  readonly status: string | null
}

const readStoredTerminalSessionFields = (value: JsonObject): StoredTerminalSessionFields => ({
  createdAt: readString(value["createdAt"]),
  id: readString(value["id"]),
  projectId: readString(value["projectId"]),
  sshCommand: readString(value["sshCommand"]),
  status: readString(value["status"])
})

const hasStoredTerminalSessionFields = (
  fields: StoredTerminalSessionFields
): fields is StoredTerminalSessionFields & {
  readonly createdAt: string
  readonly id: string
  readonly projectId: string
  readonly sshCommand: string
  readonly status: ActiveTerminalSession["session"]["status"]
} =>
  [fields.createdAt, fields.id, fields.projectId, fields.sshCommand].every((field) => field !== null) &&
  isStoredTerminalStatus(fields.status)

const decodeStoredTerminalSessionCore = (
  value: JsonValue | undefined
): ActiveTerminalSession["session"] | null => {
  if (!isRecord(value)) {
    return null
  }
  const fields = readStoredTerminalSessionFields(value)
  if (!hasStoredTerminalSessionFields(fields)) {
    return null
  }
  return {
    attachedClients: typeof value["attachedClients"] === "number" ? value["attachedClients"] : undefined,
    closedAt: readOptionalString(value["closedAt"]),
    createdAt: fields.createdAt,
    exitCode: typeof value["exitCode"] === "number" ? value["exitCode"] : undefined,
    id: fields.id,
    projectId: fields.projectId,
    signal: typeof value["signal"] === "number" ? value["signal"] : undefined,
    sshCommand: fields.sshCommand,
    startedAt: readOptionalString(value["startedAt"]),
    status: fields.status
  }
}

type StoredActiveTerminalSessionFields = {
  readonly closePath: string | null
  readonly exitMessage: string | null
  readonly header: string | null
  readonly pendingConnectionMessage: string | null
  readonly pendingConnectionPhase: string | null
  readonly pendingDeleteMessage: string | null
  readonly readyMessage: string | null
  readonly session: ActiveTerminalSession["session"] | null
  readonly sessionPath: string | null
  readonly subtitle: string | null
  readonly websocketPath: string | null
}

const readStoredActiveTerminalSessionFields = (value: JsonObject): StoredActiveTerminalSessionFields => ({
  closePath: readString(value["closePath"]),
  exitMessage: readString(value["exitMessage"]),
  header: readString(value["header"]),
  pendingConnectionMessage: readString(value["pendingConnectionMessage"]),
  pendingConnectionPhase: readString(value["pendingConnectionPhase"]),
  pendingDeleteMessage: readString(value["pendingDeleteMessage"]),
  readyMessage: readString(value["readyMessage"]),
  session: decodeStoredTerminalSessionCore(value["session"]),
  sessionPath: readString(value["sessionPath"]),
  subtitle: readString(value["subtitle"]),
  websocketPath: readString(value["websocketPath"])
})

const isStoredPendingConnectionPhase = (
  value: string | null
): value is NonNullable<ActiveTerminalSession["pendingConnection"]>["phase"] =>
  value === "connecting" || value === "error"

const hasStoredActiveTerminalSessionFields = (
  fields: StoredActiveTerminalSessionFields
): fields is StoredActiveTerminalSessionFields & {
  readonly closePath: string
  readonly exitMessage: string
  readonly header: string
  readonly pendingConnectionMessage: string | null
  readonly pendingConnectionPhase: NonNullable<ActiveTerminalSession["pendingConnection"]>["phase"] | null
  readonly pendingDeleteMessage: string
  readonly readyMessage: string
  readonly session: ActiveTerminalSession["session"]
  readonly sessionPath: string | null
  readonly subtitle: string
  readonly websocketPath: string
} =>
  [
    fields.closePath,
    fields.exitMessage,
    fields.header,
    fields.pendingDeleteMessage,
    fields.readyMessage,
    fields.session,
    fields.subtitle,
    fields.websocketPath
  ].every((field) => field !== null) &&
  (fields.pendingConnectionPhase === null || isStoredPendingConnectionPhase(fields.pendingConnectionPhase))

const decodeStoredActiveTerminalSession = (value: JsonValue | undefined): ActiveTerminalSession | null => {
  if (!isRecord(value)) {
    return null
  }
  const fields = readStoredActiveTerminalSessionFields(value)
  if (!hasStoredActiveTerminalSessionFields(fields)) {
    return null
  }
  return {
    browserProjectId: readOptionalString(value["browserProjectId"]),
    browserProjectKey: readOptionalString(value["browserProjectKey"]),
    browserProjectName: readOptionalString(value["browserProjectName"]),
    closePath: fields.closePath,
    exitMessage: fields.exitMessage,
    header: fields.header,
    ...(fields.pendingConnectionMessage !== null && fields.pendingConnectionPhase !== null
      ? {
        pendingConnection: {
          message: fields.pendingConnectionMessage,
          phase: fields.pendingConnectionPhase
        }
      }
      : {}),
    pendingDeleteMessage: fields.pendingDeleteMessage,
    readyMessage: fields.readyMessage,
    session: fields.session,
    sessionPath: fields.sessionPath ?? undefined,
    subtitle: fields.subtitle,
    websocketPath: fields.websocketPath
  }
}

const decodeStoredTerminalWorkspace = (value: JsonValue | undefined): TerminalWorkspaceState | null => {
  if (!isRecord(value)) {
    return null
  }
  const activeTerminalSessionId = readStoredActiveSessionId(value["activeTerminalSessionId"])
  const rawSessions = readJsonArray(value["terminalSessions"])
  const savedAt = typeof value["savedAt"] === "number" ? value["savedAt"] : null
  if (activeTerminalSessionId === undefined || rawSessions === null || savedAt === null) {
    return null
  }
  const terminalSessions = rawSessions
    .map((session) => decodeStoredActiveTerminalSession(session))
    .filter((session): session is ActiveTerminalSession => session !== null)
  return terminalSessions.length === 0
    ? emptyTerminalWorkspaceState
    : {
      activeTerminalSessionId,
      terminalSessions
    }
}

export const readStoredTerminalWorkspace = (): TerminalWorkspaceState => {
  const read = Effect.try({
    try: () => globalThis.sessionStorage.getItem(terminalWorkspaceStorageKey),
    catch: () => null
  }).pipe(
    Effect.either,
    Effect.map((result) =>
      Either.match(result, {
        onLeft: () => emptyTerminalWorkspaceState,
        onRight: (raw) => {
          if (raw === null) {
            return emptyTerminalWorkspaceState
          }
          const parsed = Either.getOrNull(ParseResult.decodeUnknownEither(JsonValueFromStringSchema)(raw))
          const decoded = decodeStoredTerminalWorkspace(parsed ?? undefined)
          return decoded === null ? emptyTerminalWorkspaceState : deactivateTerminalWorkspaceState(decoded)
        }
      })
    )
  )
  return Effect.runSync(read)
}

const toStoredActiveTerminalSession = (session: ActiveTerminalSession): StoredActiveTerminalSession => ({
  browserProjectId: session.browserProjectId,
  browserProjectKey: session.browserProjectKey,
  browserProjectName: session.browserProjectName,
  closePath: session.closePath,
  exitMessage: session.exitMessage,
  header: session.header,
  pendingConnectionMessage: session.pendingConnection?.message,
  pendingConnectionPhase: session.pendingConnection?.phase,
  pendingDeleteMessage: session.pendingDeleteMessage,
  readyMessage: session.readyMessage,
  session: session.session,
  sessionPath: session.sessionPath,
  subtitle: session.subtitle,
  websocketPath: session.websocketPath
})

export const writeStoredTerminalWorkspace = (state: TerminalWorkspaceState): void => {
  const write = Effect.try({
    try: () => {
      if (state.terminalSessions.length === 0) {
        globalThis.sessionStorage.removeItem(terminalWorkspaceStorageKey)
        return
      }
      const payload: StoredTerminalWorkspaceState = {
        activeTerminalSessionId: state.activeTerminalSessionId,
        savedAt: Date.now(),
        terminalSessions: state.terminalSessions.map((session) => toStoredActiveTerminalSession(session))
      }
      globalThis.sessionStorage.setItem(terminalWorkspaceStorageKey, JSON.stringify(payload))
    },
    catch: () => null
  }).pipe(
    Effect.either,
    Effect.asVoid
  )
  Effect.runSync(write)
}
