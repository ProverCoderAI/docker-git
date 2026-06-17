import { Effect } from "effect"

import { formatProjectEventLine } from "../docker-git/project-event-lines.js"
import type { ApiEvent } from "./api.js"
import { loadProjectEvents } from "./api.js"

type EventStreamControls = {
  readonly close: () => void
}

type EventStreamHandlers = {
  readonly onLine: (line: string) => void
  readonly onEvent?: (event: ApiEvent) => void
  readonly onRateLimit: () => void
  readonly initialCursor?: number | undefined
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
  state.timeout = setTimeout(runPoll, delayMs)
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
  onEvent: ((event: ApiEvent) => void) | undefined,
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
    const line = formatProjectEventLine(event)
    if (line !== null) {
      onLine(line)
    }
    onEvent?.(event)
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
  { initialCursor, onEvent, onLine, onRateLimit }: EventStreamHandlers
): EventStreamControls => {
  const state: PollState = {
    closed: false,
    cursor: initialCursor,
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
            handlePollSuccess(state, onLine, onEvent, response, runPoll)
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
        clearTimeout(state.timeout)
      }
    }
  }
}
