import { Chunk, Duration, Effect, Ref } from "effect"
import * as Stream from "effect/Stream"
import type { PlatformError } from "@effect/platform/Error"
import type * as HttpBody from "@effect/platform/HttpBody"
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import * as HttpServerError from "@effect/platform/HttpServerError"
import * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"

import { ApiBadRequestError, ApiConflictError, ApiInternalError, ApiNotFoundError, describeUnknown } from "./api/errors.js"
import { CreateAgentRequestSchema, CreateFollowRequestSchema, CreateProjectRequestSchema } from "./api/schema.js"
import { uiHtml, uiScript, uiStyles } from "./ui.js"
import { getAgent, getAgentAttachInfo, listAgents, readAgentLogs, startAgent, stopAgent } from "./services/agents.js"
import { latestProjectCursor, listProjectEventsSince } from "./services/events.js"
import {
  createFollowSubscription,
  ingestFederationInbox,
  listFederationIssues,
  listFollowSubscriptions,
  makeFederationActorDocument,
  makeFederationContext,
  makeFederationFollowersCollection,
  makeFederationFollowingCollection,
  makeFederationLikedCollection,
  makeFederationOutboxCollection
} from "./services/federation.js"
import {
  createProjectFromRequest,
  deleteProjectById,
  downProject,
  getProject,
  listProjects,
  readProjectLogs,
  readProjectPs,
  recreateProject,
  upProject
} from "./services/projects.js"

const ProjectParamsSchema = Schema.Struct({
  projectId: Schema.String
})

const AgentParamsSchema = Schema.Struct({
  projectId: Schema.String,
  agentId: Schema.String
})

type ApiError =
  | ApiBadRequestError
  | ApiNotFoundError
  | ApiConflictError
  | ApiInternalError
  | ParseResult.ParseError
  | HttpBody.HttpBodyError
  | HttpServerError.RequestError
  | PlatformError

const jsonResponse = (data: unknown, status: number) =>
  Effect.map(HttpServerResponse.json(data), (response) => HttpServerResponse.setStatus(response, status))

const textResponse = (data: string, contentType: string, status = 200) =>
  Effect.succeed(
    HttpServerResponse.setStatus(
      HttpServerResponse.text(data, { contentType }),
      status
    )
  )

const parseQueryInt = (url: string, key: string, fallback: number): number => {
  const parsed = Number(new URL(url, "http://localhost").searchParams.get(key) ?? "")
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.floor(parsed)
}

const errorResponse = (error: ApiError | unknown) => {
  if (ParseResult.isParseError(error)) {
    return jsonResponse(
      {
        error: {
          type: "ParseError",
          message: ParseResult.TreeFormatter.formatIssueSync(error.issue)
        }
      },
      400
    )
  }

  if (error instanceof ApiBadRequestError) {
    return jsonResponse({ error: { type: error._tag, message: error.message, details: error.details } }, 400)
  }

  if (error instanceof ApiNotFoundError) {
    return jsonResponse({ error: { type: error._tag, message: error.message } }, 404)
  }

  if (error instanceof ApiConflictError) {
    return jsonResponse({ error: { type: error._tag, message: error.message } }, 409)
  }

  if (error instanceof ApiInternalError) {
    return jsonResponse({ error: { type: error._tag, message: error.message } }, 500)
  }

  return jsonResponse(
    {
      error: {
        type: "InternalError",
        message: describeUnknown(error)
      }
    },
    500
  )
}

const projectParams = HttpRouter.schemaParams(ProjectParamsSchema)
const agentParams = HttpRouter.schemaParams(AgentParamsSchema)

const readCreateProjectRequest = () => HttpServerRequest.schemaBodyJson(CreateProjectRequestSchema)
const readCreateFollowRequest = () => HttpServerRequest.schemaBodyJson(CreateFollowRequestSchema)
const readInboxPayload = () => HttpServerRequest.schemaBodyJson(Schema.Unknown)

const configuredFederationPublicOrigin =
  process.env["DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN"] ??
  process.env["DOCKER_GIT_API_PUBLIC_URL"]

const configuredFederationActorUsername =
  process.env["DOCKER_GIT_FEDERATION_ACTOR"] ?? "docker-git"

const readHeader = (
  request: HttpServerRequest.HttpServerRequest,
  key: string
): string | undefined => {
  const value = request.headers[key.toLowerCase()]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

const firstCommaValue = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined
  }
  const first = value.split(",")[0]?.trim()
  return first && first.length > 0 ? first : undefined
}

const resolveRequestOrigin = (request: HttpServerRequest.HttpServerRequest): string => {
  const forwardedHost = firstCommaValue(readHeader(request, "x-forwarded-host"))
  const host = forwardedHost ?? readHeader(request, "host")
  const proto = firstCommaValue(readHeader(request, "x-forwarded-proto")) ?? "http"
  if (host === undefined || host.length === 0) {
    return "http://localhost:3334"
  }
  return `${proto}://${host}`
}

const resolveFederationContext = (
  request: HttpServerRequest.HttpServerRequest,
  requestedDomain?: string | undefined
) => {
  const fromBody = requestedDomain?.trim()
  const publicOrigin =
    fromBody && fromBody.length > 0
      ? fromBody
      : configuredFederationPublicOrigin ?? resolveRequestOrigin(request)

  return makeFederationContext({
    publicOrigin,
    actorUsername: configuredFederationActorUsername
  })
}

export const makeRouter = () => {
  const base = HttpRouter.empty.pipe(
    HttpRouter.get("/", 
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        console.log("GET / request:", request.url, "headers:", request.headers)
        return yield* _(textResponse(uiHtml, "text/html; charset=utf-8", 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get("/ui/styles.css", textResponse(uiStyles, "text/css; charset=utf-8", 200)),
    HttpRouter.get("/ui/app.js", textResponse(uiScript, "application/javascript; charset=utf-8", 200)),
    HttpRouter.get("/health", jsonResponse({ ok: true }, 200)),
    HttpRouter.get(
      "/federation/issues",
      Effect.sync(() => ({ issues: listFederationIssues() })).pipe(
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/federation/actor",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const context = yield* _(resolveFederationContext(request))
        return yield* _(jsonResponse(makeFederationActorDocument(context), 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/federation/outbox",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const context = yield* _(resolveFederationContext(request))
        return yield* _(jsonResponse(makeFederationOutboxCollection(context), 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/federation/followers",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const context = yield* _(resolveFederationContext(request))
        return yield* _(jsonResponse(makeFederationFollowersCollection(context), 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/federation/following",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const context = yield* _(resolveFederationContext(request))
        return yield* _(jsonResponse(makeFederationFollowingCollection(context), 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/federation/liked",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const context = yield* _(resolveFederationContext(request))
        return yield* _(jsonResponse(makeFederationLikedCollection(context), 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/federation/follows",
      Effect.gen(function*(_) {
        const requestBody = yield* _(readCreateFollowRequest())
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const context = yield* _(resolveFederationContext(request, requestBody.domain))
        const created = yield* _(createFollowSubscription(requestBody, context))
        return yield* _(jsonResponse(created, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/federation/follows",
      Effect.sync(() => ({ follows: listFollowSubscriptions() })).pipe(
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/federation/inbox",
      Effect.gen(function*(_) {
        const payload = yield* _(readInboxPayload())
        const result = yield* _(ingestFederationInbox(payload))
        return yield* _(jsonResponse({ result }, 202))
      }).pipe(Effect.catchAll(errorResponse))
    )
  )

  const withProjects = base.pipe(
    HttpRouter.get(
      "/projects",
      listProjects().pipe(
        Effect.flatMap((projects) => jsonResponse({ projects }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects",
      Effect.gen(function*(_) {
        const request = yield* _(readCreateProjectRequest())
        const project = yield* _(createProjectFromRequest(request))
        return yield* _(jsonResponse({ project }, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/projects/:projectId",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => getProject(projectId)),
        Effect.flatMap((project) => jsonResponse({ project }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.del(
      "/projects/:projectId",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => deleteProjectById(projectId)),
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/up",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => upProject(projectId)),
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/down",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => downProject(projectId)),
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/recreate",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => recreateProject(projectId)),
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/ps",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => readProjectPs(projectId)),
        Effect.flatMap((output) => jsonResponse({ output }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/logs",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => readProjectLogs(projectId)),
        Effect.flatMap((output) => jsonResponse({ output }, 200)),
        Effect.catchAll(errorResponse)
      )
    )
  )

  const withAgents = withProjects.pipe(
    HttpRouter.post(
      "/projects/:projectId/agents",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const project = yield* _(getProject(projectId))
        const request = yield* _(HttpServerRequest.schemaBodyJson(CreateAgentRequestSchema))
        const session = yield* _(startAgent(project, request))
        return yield* _(jsonResponse({ session }, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/projects/:projectId/agents",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => jsonResponse({ sessions: listAgents(projectId) }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/agents/:agentId",
      agentParams.pipe(
        Effect.flatMap(({ projectId, agentId }) => getAgent(projectId, agentId)),
        Effect.flatMap((session) => jsonResponse({ session }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/agents/:agentId/attach",
      agentParams.pipe(
        Effect.flatMap(({ projectId, agentId }) => getAgentAttachInfo(projectId, agentId)),
        Effect.flatMap((attach) => jsonResponse({ attach }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/agents/:agentId/stop",
      agentParams.pipe(
        Effect.flatMap(({ projectId, agentId }) =>
          Effect.gen(function*(_) {
            const project = yield* _(getProject(projectId))
            return yield* _(stopAgent(projectId, project.projectDir, project.containerName, agentId))
          })
        ),
        Effect.flatMap((session) => jsonResponse({ session }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/agents/:agentId/logs",
      agentParams.pipe(
        Effect.flatMap(({ projectId, agentId }) =>
          Effect.gen(function*(_) {
            const request = yield* _(HttpServerRequest.HttpServerRequest)
            const lines = parseQueryInt(request.url, "lines", 200)
            const entries = yield* _(readAgentLogs(projectId, agentId, lines))
            return { entries, lines }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    )
  )

  return withAgents.pipe(
    HttpRouter.get(
      "/projects/:projectId/events",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) =>
          Effect.gen(function*(_) {
            const request = yield* _(HttpServerRequest.HttpServerRequest)
            const startCursor = parseQueryInt(request.url, "cursor", 0)
            const cursorRef = yield* _(Ref.make(startCursor))
            const snapshotRef = yield* _(Ref.make(false))
            const encoder = new TextEncoder()

            const encodeSse = (event: string, data: unknown, id?: number): Uint8Array => {
              const idLine = id === undefined ? "" : `id: ${id}\n`
              return encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            }

            const poll = Effect.gen(function* (_) {
              const snapshotSent = yield* _(Ref.get(snapshotRef))

              if (!snapshotSent) {
                yield* _(Ref.set(snapshotRef, true))
                const cursor = latestProjectCursor(projectId)
                yield* _(Ref.set(cursorRef, cursor))
                return Chunk.of(
                  encodeSse("snapshot", {
                    projectId,
                    cursor,
                    agents: listAgents(projectId)
                  }, cursor)
                )
              }

              const currentCursor = yield* _(Ref.get(cursorRef))
              const events = listProjectEventsSince(projectId, currentCursor)
              if (events.length === 0) {
                yield* _(Effect.sleep(Duration.millis(500)))
                return Chunk.empty<Uint8Array>()
              }

              const nextCursor = events[events.length - 1]?.seq ?? currentCursor
              yield* _(Ref.set(cursorRef, nextCursor))
              const encoded = events.map((event) => encodeSse(event.type, event, event.seq))
              return Chunk.fromIterable(encoded)
            })

            return HttpServerResponse.stream(Stream.repeatEffectChunk(poll), {
              headers: {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                "connection": "keep-alive"
              }
            })
          })
        ),
        Effect.catchAll(errorResponse)
      )
    )
  )
}
