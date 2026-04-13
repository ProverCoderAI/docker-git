import { Duration, Effect, Ref, Schedule } from "effect"
import * as Fiber from "effect/Fiber"

import { request } from "./api-http.js"
import { asArray, asObject, asString, type JsonValue } from "./api-json.js"
import { formatProjectEventLine } from "./project-event-lines.js"

const projectPath = (projectId: string, suffix = ""): string => `/projects/${encodeURIComponent(projectId)}${suffix}`
const projectEventPollInterval = Duration.millis(250)

type ProjectEvent = {
  readonly seq: number
  readonly type: string
  readonly payload: JsonValue | undefined
}

type ProjectEventPollResponse = {
  readonly cursor: number
  readonly events: ReadonlyArray<ProjectEvent>
}

export type ProjectEventPolling = {
  readonly cursorRef: Ref.Ref<number>
  readonly fiber: Fiber.RuntimeFiber<number>
  readonly projectId: string
}

const asNumber = (value: JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const decodeProjectEvent = (payload: JsonValue): ProjectEvent | null => {
  const object = asObject(payload)
  if (object === null) {
    return null
  }

  const seq = asNumber(object["seq"])
  const type = asString(object["type"])
  if (seq === null || type === null) {
    return null
  }

  return {
    seq,
    type,
    payload: object["payload"]
  }
}

const decodeProjectEventPollResponse = (payload: JsonValue): ProjectEventPollResponse | null => {
  const object = asObject(payload)
  if (object === null) {
    return null
  }

  const cursor = asNumber(object["cursor"])
  if (cursor === null) {
    return null
  }

  return {
    cursor,
    events: asArray(object["events"])
      .map((event) => decodeProjectEvent(event))
      .filter((event): event is ProjectEvent => event !== null)
  }
}

const writeProjectEventLines = (events: ReadonlyArray<ProjectEvent>) =>
  Effect.sync(() => {
    for (const event of events) {
      const line = formatProjectEventLine(event)
      if (line !== null) {
        process.stdout.write(`${line}\n`)
      }
    }
  })

export const readProjectEventCursor = (projectId: string) =>
  request("GET", projectPath(projectId, "/events-poll")).pipe(
    Effect.map((payload) => decodeProjectEventPollResponse(payload)?.cursor ?? 0)
  )

const pollProjectEventsOnce = (
  projectId: string,
  cursorRef: Ref.Ref<number>
) =>
  Effect.gen(function*(_) {
    const cursor = yield* _(Ref.get(cursorRef))
    const payload = yield* _(request("GET", projectPath(projectId, `/events-poll?cursor=${cursor}`)))
    const response = decodeProjectEventPollResponse(payload)
    if (response === null) {
      return
    }

    yield* _(Ref.set(cursorRef, response.cursor))
    yield* _(writeProjectEventLines(response.events))
  })

export const startProjectEventPolling = (projectId: string, initialCursor: number) =>
  Effect.gen(function*(_) {
    const cursorRef = yield* _(Ref.make(initialCursor))
    const fiber = yield* _(
      pollProjectEventsOnce(projectId, cursorRef).pipe(
        Effect.ignore,
        Effect.repeat(
          Schedule.addDelay(
            Schedule.forever,
            () => projectEventPollInterval
          )
        ),
        Effect.fork
      )
    )

    return { cursorRef, fiber, projectId } satisfies ProjectEventPolling
  })

export const stopProjectEventPolling = (polling: ProjectEventPolling) =>
  Fiber.interrupt(polling.fiber).pipe(
    Effect.zipRight(
      pollProjectEventsOnce(polling.projectId, polling.cursorRef).pipe(
        Effect.ignore
      )
    )
  )
