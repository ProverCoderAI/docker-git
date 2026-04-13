import { Effect } from "effect"

import { asObject, asString } from "../docker-git/api-json.js"
import type { JsonValue } from "../docker-git/api-json.js"
import type { ApiEvent } from "./api.js"
import { loadProjectEvents } from "./api.js"

type EventStreamControls = {
  readonly close: () => void
}

type EventStreamHandlers = {
  readonly onLine: (line: string) => void
  readonly onRateLimit: () => void
}

const readPayloadString = (
  payload: JsonValue | undefined,
  key: string
): string | null => {
  const object = asObject(payload)
  if (object === null) {
    return null
  }
  return asString(object[key])
}

const formatStatusLine = (payload: JsonValue | undefined): string | null => {
  const phase = readPayloadString(payload, "phase")
  const message = readPayloadString(payload, "message")
  if (message === null) {
    return null
  }
  return phase === null ? message : `[${phase}] ${message}`
}

const formatLogLine = (payload: JsonValue | undefined): string | null => readPayloadString(payload, "line")

const formatSshLine = (payload: JsonValue | undefined): string | null => {
  const phase = readPayloadString(payload, "phase")
  const sessionId = readPayloadString(payload, "sessionId")
  if (phase === null) {
    return null
  }
  if (sessionId === null) {
    return `[ssh] ${phase}`
  }
  return `[ssh] ${phase} (${sessionId})`
}

const formatEventLine = (event: ApiEvent): string | null => {
  if (event.type === "project.deployment.status") {
    return formatStatusLine(event.payload)
  }
  if (event.type === "project.deployment.log") {
    return formatLogLine(event.payload)
  }
  if (event.type === "project.ssh.session") {
    return formatSshLine(event.payload)
  }
  return null
}

type PollState = {
  closed: boolean
  cursor: number | undefined
  timeout: ReturnType<typeof globalThis.setTimeout> | null
}

type EventPollSuccess = {
  readonly cursor: number
  readonly events: ReadonlyArray<ApiEvent>
}

const schedulePoll = (
  state: PollState,
  runPoll: () => void,
  delayMs: number
): void => {
  state.timeout = globalThis.setTimeout(runPoll, delayMs)
}

const handlePollFailure = (
  state: PollState,
  onLine: (line: string) => void,
  onRateLimit: () => void,
  error: string,
  runPoll: () => void
): void => {
  if (state.closed) {
    return
  }
  if (error.includes("HTTP 429")) {
    onRateLimit()
    return
  }
  onLine(`[events] ${error}`)
  schedulePoll(state, runPoll, 1000)
}

const handlePollSuccess = (
  state: PollState,
  onLine: (line: string) => void,
  response: EventPollSuccess,
  runPoll: () => void
): void => {
  if (state.closed) {
    return
  }
  const isInitialPoll = state.cursor === undefined
  if (isInitialPoll) {
    onLine("[events] connected")
  }
  state.cursor = response.cursor
  for (const event of response.events) {
    const line = formatEventLine(event)
    if (line !== null) {
      onLine(line)
    }
  }
  let delayMs = 150
  if (isInitialPoll) {
    delayMs = 100
  } else if (response.events.length === 0) {
    delayMs = 500
  }
  schedulePoll(state, runPoll, delayMs)
}

export const openProjectEventStream = (
  projectId: string,
  { onLine, onRateLimit }: EventStreamHandlers
): EventStreamControls => {
  const state: PollState = {
    closed: false,
    cursor: undefined,
    timeout: null
  }

  const runPoll = () => {
    void Effect.runPromise(
      poll().pipe(
        Effect.match({
          onFailure: (error) => {
            handlePollFailure(state, onLine, onRateLimit, error, runPoll)
          },
          onSuccess: (response) => {
            handlePollSuccess(state, onLine, response, runPoll)
          }
        })
      )
    )
  }

  const poll = () => loadProjectEvents(projectId, state.cursor)

  runPoll()

  return {
    close: () => {
      state.closed = true
      if (state.timeout !== null) {
        globalThis.clearTimeout(state.timeout)
      }
    }
  }
}
