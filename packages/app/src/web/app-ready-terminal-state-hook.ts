import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"
import { useCallback, useEffect, useState } from "react"

import { JsonValueSchema } from "../shared/json-schema.js"
import type { JsonObject, JsonValue } from "../shared/json-schema.js"
import {
  activeTerminalSession,
  addTerminalSessionState,
  emptyTerminalWorkspaceState,
  removeTerminalSessionState,
  selectTerminalSessionState,
  type TerminalWorkspaceState
} from "./terminal-state.js"
import type { ActiveTerminalSession } from "./terminal.js"

export type TerminalWorkspaceReadyState = {
  readonly activeTerminalSession: ActiveTerminalSession | null
  readonly activeTerminalSessionId: string | null
  readonly addTerminalSession: (session: ActiveTerminalSession) => void
  readonly closeTerminalSession: (sessionId: string) => void
  readonly selectTerminalSession: (sessionId: string) => void
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
}

type StoredActiveTerminalSession = Omit<ActiveTerminalSession, "onExit" | "onReady">

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

const decodeStoredTerminalSessionCore = (
  value: JsonValue | undefined
): ActiveTerminalSession["session"] | null => {
  if (!isRecord(value)) {
    return null
  }
  const id = readString(value["id"])
  const projectId = readString(value["projectId"])
  const sshCommand = readString(value["sshCommand"])
  const status = readString(value["status"])
  const createdAt = readString(value["createdAt"])
  if (
    id === null ||
    projectId === null ||
    sshCommand === null ||
    createdAt === null ||
    (status !== "ready" && status !== "attached" && status !== "exited" && status !== "failed")
  ) {
    return null
  }
  return {
    closedAt: readOptionalString(value["closedAt"]),
    createdAt,
    exitCode: typeof value["exitCode"] === "number" ? value["exitCode"] : undefined,
    id,
    projectId,
    signal: typeof value["signal"] === "number" ? value["signal"] : undefined,
    sshCommand,
    startedAt: readOptionalString(value["startedAt"]),
    status
  }
}

const decodeStoredActiveTerminalSession = (value: JsonValue | undefined): ActiveTerminalSession | null => {
  if (!isRecord(value)) {
    return null
  }
  const closePath = readString(value["closePath"])
  const exitMessage = readString(value["exitMessage"])
  const header = readString(value["header"])
  const pendingDeleteMessage = readString(value["pendingDeleteMessage"])
  const readyMessage = readString(value["readyMessage"])
  const session = decodeStoredTerminalSessionCore(value["session"])
  const subtitle = readString(value["subtitle"])
  const websocketPath = readString(value["websocketPath"])
  if (
    closePath === null ||
    exitMessage === null ||
    header === null ||
    pendingDeleteMessage === null ||
    readyMessage === null ||
    session === null ||
    subtitle === null ||
    websocketPath === null
  ) {
    return null
  }
  return {
    browserProjectId: readOptionalString(value["browserProjectId"]),
    browserProjectName: readOptionalString(value["browserProjectName"]),
    closePath,
    exitMessage,
    header,
    pendingDeleteMessage,
    readyMessage,
    session,
    subtitle,
    websocketPath
  }
}

const decodeStoredTerminalWorkspace = (value: JsonValue | undefined): TerminalWorkspaceState | null => {
  if (!isRecord(value)) {
    return null
  }
  const savedAt = typeof value["savedAt"] === "number" ? value["savedAt"] : null
  const activeTerminalSessionId = readStoredActiveSessionId(value["activeTerminalSessionId"])
  const rawSessions = readJsonArray(value["terminalSessions"])
  if (savedAt === null || activeTerminalSessionId === undefined || rawSessions === null) {
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

const readStoredTerminalWorkspace = (): TerminalWorkspaceState => {
  const read = Effect.try({
    try: () => globalThis.sessionStorage.getItem(terminalWorkspaceStorageKey),
    catch: () => null
  }).pipe(
    Effect.map((raw) => {
      if (raw === null) {
        return emptyTerminalWorkspaceState
      }
      const parsed = Either.getOrNull(ParseResult.decodeUnknownEither(JsonValueFromStringSchema)(raw))
      const decoded = decodeStoredTerminalWorkspace(parsed ?? undefined)
      return decoded ?? emptyTerminalWorkspaceState
    }),
    Effect.catchAll(() => Effect.succeed(emptyTerminalWorkspaceState))
  )
  return Effect.runSync(read)
}

const toStoredActiveTerminalSession = (session: ActiveTerminalSession): StoredActiveTerminalSession => ({
  browserProjectId: session.browserProjectId,
  browserProjectName: session.browserProjectName,
  closePath: session.closePath,
  exitMessage: session.exitMessage,
  header: session.header,
  pendingDeleteMessage: session.pendingDeleteMessage,
  readyMessage: session.readyMessage,
  session: session.session,
  subtitle: session.subtitle,
  websocketPath: session.websocketPath
})

const writeStoredTerminalWorkspace = (state: TerminalWorkspaceState): void => {
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
  }).pipe(Effect.catchAll(() => Effect.void))
  Effect.runSync(write)
}

export const useTerminalWorkspaceState = (): TerminalWorkspaceReadyState => {
  const [terminalWorkspace, setTerminalWorkspace] = useState<TerminalWorkspaceState>(readStoredTerminalWorkspace)
  const addTerminalSession = useCallback((session: ActiveTerminalSession) => {
    setTerminalWorkspace((state) => addTerminalSessionState(state, session))
  }, [])
  const closeTerminalSession = useCallback((sessionId: string) => {
    setTerminalWorkspace((state) => removeTerminalSessionState(state, sessionId))
  }, [])
  const selectTerminalSession = useCallback((sessionId: string) => {
    setTerminalWorkspace((state) => selectTerminalSessionState(state, sessionId))
  }, [])

  useEffect(() => {
    writeStoredTerminalWorkspace(terminalWorkspace)
  }, [terminalWorkspace])

  return {
    activeTerminalSession: activeTerminalSession(terminalWorkspace),
    activeTerminalSessionId: terminalWorkspace.activeTerminalSessionId,
    addTerminalSession,
    closeTerminalSession,
    selectTerminalSession,
    terminalSessions: terminalWorkspace.terminalSessions
  }
}
