import { Duration, Effect, Ref, Schedule } from "effect"
import * as Fiber from "effect/Fiber"

import { request } from "./api-http.js"
import { asArray, asObject, asString, type JsonValue } from "./api-json.js"
import { type ApiProjectDetails, decodeProjectDetails } from "./api-project-codec.js"
import type { ControllerRuntime } from "./controller.js"
import type { ApiAuthRequiredError, ApiRequestError } from "./host-errors.js"
import { formatProjectEventLine } from "./project-event-lines.js"

const projectPath = (projectId: string, suffix = ""): string => `/projects/${encodeURIComponent(projectId)}${suffix}`
const projectEventPollInterval = Duration.millis(250)

export type ProjectEvent = {
  readonly seq: number
  readonly type: string
  readonly payload: JsonValue | undefined
}

type ProjectEventPollResponse = {
  readonly cursor: number
  readonly events: ReadonlyArray<ProjectEvent>
}

type ProjectCreationWaitError = ApiAuthRequiredError | ApiRequestError

export type ProjectCreationResult = {
  readonly projectId: string
  readonly project: ApiProjectDetails | null
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

const readProjectEventPayloadField = (
  event: ProjectEvent,
  key: string
): string | null => {
  const object = asObject(event.payload)
  return object === null ? null : asString(object[key])
}

const readCreatedProject = (
  event: ProjectEvent,
  fallbackProjectId: string
): ProjectCreationResult | null => {
  if (event.type !== "project.created") {
    return null
  }

  const payload = asObject(event.payload)
  const projectId = readProjectEventPayloadField(event, "projectId") ?? fallbackProjectId
  const project = payload === null ? null : decodeProjectDetails(payload["project"] ?? null)
  return { projectId, project }
}

const readFailedMessage = (event: ProjectEvent): string | null =>
  event.type === "project.deployment.status" && readProjectEventPayloadField(event, "phase") === "failed"
    ? (readProjectEventPayloadField(event, "message") ?? "Project creation failed.")
    : null

const toProjectCreationError = (
  projectId: string,
  message: string
): ApiRequestError => ({
  _tag: "ApiRequestError",
  method: "POST",
  path: "/projects",
  message: `${message}\nProject event stream: ${projectId}`,
  displayOnlyMessage: true
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
      return {
        cursor,
        events: []
      } satisfies ProjectEventPollResponse
    }

    yield* _(Ref.set(cursorRef, response.cursor))
    yield* _(writeProjectEventLines(response.events))
    return response
  })

const findCreatedProject = (
  projectId: string,
  events: ReadonlyArray<ProjectEvent>
): ProjectCreationResult | null => {
  for (const event of events) {
    const created = readCreatedProject(event, projectId)
    if (created !== null) {
      return created
    }
  }
  return null
}

const findFailureMessage = (
  events: ReadonlyArray<ProjectEvent>
): string | null => {
  for (const event of events) {
    const message = readFailedMessage(event)
    if (message !== null) {
      return message
    }
  }
  return null
}

const waitForProjectCreationLoop = (
  projectId: string,
  cursorRef: Ref.Ref<number>
): Effect.Effect<ProjectCreationResult, ProjectCreationWaitError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    const response = yield* _(pollProjectEventsOnce(projectId, cursorRef))
    const failureMessage = findFailureMessage(response.events)
    if (failureMessage !== null) {
      return yield* _(Effect.fail(toProjectCreationError(projectId, failureMessage)))
    }

    const created = findCreatedProject(projectId, response.events)
    if (created !== null) {
      return created
    }

    yield* _(Effect.sleep(projectEventPollInterval))
    return yield* _(waitForProjectCreationLoop(projectId, cursorRef))
  })

export const waitForProjectCreation = (
  projectId: string,
  initialCursor: number
) =>
  Effect.gen(function*(_) {
    const cursorRef = yield* _(Ref.make(initialCursor))
    return yield* _(waitForProjectCreationLoop(projectId, cursorRef))
  })

export const startProjectEventPolling = (projectId: string, initialCursor: number) =>
  Effect.gen(function*(_) {
    const cursorRef = yield* _(Ref.make(initialCursor))
    const pollSchedule = Schedule.addDelay(
      Schedule.forever,
      () => projectEventPollInterval
    )
    const fiber = yield* _(
      pollProjectEventsOnce(projectId, cursorRef).pipe(
        Effect.ignore,
        Effect.repeat(pollSchedule),
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
