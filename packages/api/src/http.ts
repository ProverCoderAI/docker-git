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
import { renderError, type AppError } from "@effect-template/lib/usecases/errors"

import { ApiAuthRequiredError, ApiBadRequestError, ApiConflictError, ApiInternalError, ApiNotFoundError, describeUnknown } from "./api/errors.js"
import {
  AuthMenuRequestSchema,
  AuthTerminalSessionRequestSchema,
  ApplyAllRequestSchema,
  CodexAuthImportRequestSchema,
  CodexAuthLoginRequestSchema,
  CodexAuthLogoutRequestSchema,
  CreateAgentRequestSchema,
  CreateFollowRequestSchema,
  CreateProjectRequestSchema,
  GithubAuthLoginRequestSchema,
  GithubAuthLogoutRequestSchema,
  ProjectDatabaseProfileRequestSchema,
  ProjectAuthRequestSchema,
  ProjectPortForwardRequestSchema,
  StateCommitRequestSchema,
  StateInitRequestSchema,
  StateSyncRequestSchema,
  UpProjectRequestSchema
} from "./api/schema.js"
import type { UpProjectRequestInput } from "./api/schema.js"
import { uiHtml, uiScript, uiStyles } from "./ui.js"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import { resolveWorkspaceRoot } from "@effect-template/lib/shell/workspace-root"
import {
  importCodexAuth,
  loginGithubAuth,
  logoutCodexAuth,
  logoutGithubAuth,
  readCodexAuthStatus,
  readGithubAuthStatus,
} from "./services/auth.js"
import { readAuthMenuSnapshot, runAuthMenuFlow } from "./services/auth-menu.js"
import { streamGithubAuthLogin } from "./services/auth-github-login-stream.js"
import { createAuthTerminalSession, deleteAuthTerminalSession } from "./services/auth-terminal-sessions.js"
import { streamCodexAuthLogin } from "./services/auth-codex-login-stream.js"
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
  applyAllProjects,
  createProjectFromRequest,
  deleteProjectById,
  downAllProjects,
  downProject,
  getProject,
  listProjects,
  readProjectLogs,
  readProjectPs,
  recreateProject,
  upProject
} from "./services/projects.js"
import { readProjectAuthSnapshot, runProjectAuthFlow } from "./services/project-auth.js"
import { readProjectBrowserSession, proxyProjectBrowser } from "./services/project-browser.js"
import { parseProjectBrowserProxyPath } from "./services/project-browser-core.js"
import {
  deleteProjectDatabaseForward,
  deleteProjectDatabaseProfile,
  exposeProjectDatabaseProfile,
  listProjectDatabaseForwards,
  listProjectDatabaseProfiles,
  openProjectDatabaseEditor,
  proxyProjectDatabase,
  readProjectDatabaseSession,
  restartProjectDatabaseEditor,
  saveProjectDatabaseProfile
} from "./services/project-databases.js"
import {
  parseProjectDatabaseProxyPath,
  parseProjectDatabaseStatefulProxyPath
} from "./services/project-databases-core.js"
import {
  createProjectPortForward,
  deleteProjectPortForward,
  listProjectPortForwards
} from "./services/project-port-forwards.js"
import { proxyProjectPortForward } from "./services/project-port-proxy.js"
import { parseProjectPortProxyPath } from "./services/project-port-proxy-core.js"
import { createTerminalSession, deleteTerminalSession } from "./services/terminal-sessions.js"
import {
  commitStateFromRequest,
  initStateFromRequest,
  pullState,
  pushState,
  readStatePathOutput,
  readStateStatusOutput,
  syncStateFromRequest
} from "./services/state.js"

const ProjectParamsSchema = Schema.Struct({
  projectId: Schema.String
})

const ProjectPortForwardParamsSchema = Schema.Struct({
  projectId: Schema.String,
  targetPort: Schema.String
})

const ProjectDatabaseProfileParamsSchema = Schema.Struct({
  projectId: Schema.String,
  profileId: Schema.String
})

const AgentParamsSchema = Schema.Struct({
  projectId: Schema.String,
  agentId: Schema.String
})

const TerminalSessionParamsSchema = Schema.Struct({
  projectId: Schema.String,
  sessionId: Schema.String
})

const AuthTerminalSessionParamsSchema = Schema.Struct({
  sessionId: Schema.String
})

type ApiError =
  | ApiAuthRequiredError
  | ApiBadRequestError
  | ApiNotFoundError
  | ApiConflictError
  | ApiInternalError
  | ParseResult.ParseError
  | HttpBody.HttpBodyError
  | HttpServerError.RequestError
  | PlatformError

const noStoreHeaders = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  pragma: "no-cache"
}

const appErrorTags = new Set<string>([
  "FileExistsError",
  "CloneFailedError",
  "AgentFailedError",
  "DockerAccessError",
  "DockerCommandError",
  "ConfigNotFoundError",
  "ConfigDecodeError",
  "ScrapArchiveInvalidError",
  "ScrapArchiveNotFoundError",
  "ScrapTargetDirUnsupportedError",
  "ScrapWipeRefusedError",
  "InputCancelledError",
  "InputReadError",
  "PortProbeError",
  "AuthError",
  "CommandFailedError"
])

const isAppError = (error: unknown): error is AppError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error["_tag"] === "string" &&
  appErrorTags.has(error["_tag"])

const jsonResponse = (data: unknown, status: number) =>
  Effect.map(
    HttpServerResponse.json(data, { headers: noStoreHeaders }),
    (response) => HttpServerResponse.setStatus(response, status)
  )

const textResponse = (data: string, contentType: string, status = 200) =>
  Effect.succeed(
    HttpServerResponse.setStatus(
      HttpServerResponse.text(data, { contentType, headers: noStoreHeaders }),
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

const hasQueryParam = (url: string, key: string): boolean =>
  new URL(url, "http://localhost").searchParams.has(key)

const parsePortParam = (value: string): Effect.Effect<number, ApiBadRequestError> => {
  const parsed = Number.parseInt(value, 10)
  return String(parsed) === value && parsed > 0 && parsed <= 65_535
    ? Effect.succeed(parsed)
    : Effect.fail(new ApiBadRequestError({ message: `Invalid port: ${value}` }))
}

const hostWithoutPort = (host: string): string => {
  if (host.startsWith("[")) {
    const end = host.indexOf("]")
    return end === -1 ? host : host.slice(1, end)
  }
  return host.split(":")[0] ?? host
}

const resolvePortPublicHost = (request: HttpServerRequest.HttpServerRequest): string | undefined => {
  const host = firstCommaValue(readHeader(request, "x-forwarded-host")) ?? readHeader(request, "host")
  return host === undefined || host.trim().length === 0 ? undefined : hostWithoutPort(host.trim())
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

  if (error instanceof ApiAuthRequiredError) {
    return jsonResponse(
      {
        error: {
          type: error._tag,
          message: error.message,
          provider: error.provider,
          command: error.command
        }
      },
      401
    )
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

  if (isAppError(error)) {
    return jsonResponse({ error: { type: error._tag, message: renderError(error) } }, 400)
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
const projectPortForwardParams = HttpRouter.schemaParams(ProjectPortForwardParamsSchema)
const projectDatabaseProfileParams = HttpRouter.schemaParams(ProjectDatabaseProfileParamsSchema)
const agentParams = HttpRouter.schemaParams(AgentParamsSchema)
const terminalSessionParams = HttpRouter.schemaParams(TerminalSessionParamsSchema)
const authTerminalSessionParams = HttpRouter.schemaParams(AuthTerminalSessionParamsSchema)

const readCreateProjectRequest = () => HttpServerRequest.schemaBodyJson(CreateProjectRequestSchema)
const readCreateFollowRequest = () => HttpServerRequest.schemaBodyJson(CreateFollowRequestSchema)
const readGithubAuthLoginRequest = () => HttpServerRequest.schemaBodyJson(GithubAuthLoginRequestSchema)
const readGithubAuthLogoutRequest = () => HttpServerRequest.schemaBodyJson(GithubAuthLogoutRequestSchema)
const readAuthMenuRequest = () => HttpServerRequest.schemaBodyJson(AuthMenuRequestSchema)
const readAuthTerminalSessionRequest = () => HttpServerRequest.schemaBodyJson(AuthTerminalSessionRequestSchema)
const readCodexAuthImportRequest = () => HttpServerRequest.schemaBodyJson(CodexAuthImportRequestSchema)
const readCodexAuthLoginRequest = () => HttpServerRequest.schemaBodyJson(CodexAuthLoginRequestSchema)
const readCodexAuthLogoutRequest = () => HttpServerRequest.schemaBodyJson(CodexAuthLogoutRequestSchema)
const readProjectAuthRequest = () => HttpServerRequest.schemaBodyJson(ProjectAuthRequestSchema)
const readProjectPortForwardRequest = () => HttpServerRequest.schemaBodyJson(ProjectPortForwardRequestSchema)
const readProjectDatabaseProfileRequest = () => HttpServerRequest.schemaBodyJson(ProjectDatabaseProfileRequestSchema)
const readStateInitRequest = () => HttpServerRequest.schemaBodyJson(StateInitRequestSchema)
const readStateCommitRequest = () => HttpServerRequest.schemaBodyJson(StateCommitRequestSchema)
const readStateSyncRequest = () => HttpServerRequest.schemaBodyJson(StateSyncRequestSchema)
const readApplyAllRequest = () => HttpServerRequest.schemaBodyJson(ApplyAllRequestSchema)
const emptyUpProjectRequest: UpProjectRequestInput = {}
const readUpProjectRequest = () =>
  HttpServerRequest.schemaBodyJson(UpProjectRequestSchema).pipe(
    Effect.catchAll(() => Effect.succeed(emptyUpProjectRequest))
  )
const readInboxPayload = () => HttpServerRequest.schemaBodyJson(Schema.Unknown)

const configuredFederationPublicOrigin =
  process.env["DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN"] ??
  process.env["DOCKER_GIT_API_PUBLIC_URL"]

const configuredFederationActorUsername =
  process.env["DOCKER_GIT_FEDERATION_ACTOR"] ?? "docker-git"
const controllerRevision =
  process.env["DOCKER_GIT_CONTROLLER_REV"]?.trim() ?? null

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

const terminalWebSocketUpgradeResponse = Effect.gen(function*(_) {
  const request = yield* _(HttpServerRequest.HttpServerRequest)
  const upgrade = readHeader(request, "upgrade")?.toLowerCase()
  if (upgrade === "websocket") {
    return yield* _(Effect.never)
  }
  return yield* _(
    jsonResponse(
      {
        error: {
          type: "UpgradeRequired",
          message: "Use a websocket upgrade request for terminal sessions."
        }
      },
      426
    )
  )
})

const projectProxyResponse = Effect.gen(function*(_) {
  const request = yield* _(HttpServerRequest.HttpServerRequest)
  const pathname = new URL(request.url, "http://localhost").pathname
  const browserTarget = parseProjectBrowserProxyPath(pathname)
  if (browserTarget !== null) {
    return yield* _(proxyProjectBrowser(request, browserTarget, resolveRequestOrigin(request)))
  }
  const databaseTarget = parseProjectDatabaseProxyPath(pathname)
  if (databaseTarget !== null) {
    return yield* _(proxyProjectDatabase(request, databaseTarget))
  }
  const target = parseProjectPortProxyPath(pathname)
  if (target === null) {
    const statefulDatabaseTarget = parseProjectDatabaseStatefulProxyPath(
      pathname,
      readHeader(request, "referer"),
      readHeader(request, "cookie")
    )
    if (statefulDatabaseTarget !== null) {
      return yield* _(proxyProjectDatabase(request, statefulDatabaseTarget))
    }
    return yield* _(Effect.fail(new ApiNotFoundError({ message: `Route not found: ${pathname}` })))
  }
  return yield* _(proxyProjectPortForward(request, target))
})

export const makeRouter = () => {
  const withUi = HttpRouter.empty.pipe(
    HttpRouter.get("/", 
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        console.log("GET / request:", request.url, "headers:", request.headers)
        return yield* _(textResponse(uiHtml, "text/html; charset=utf-8", 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get("/ui/styles.css", textResponse(uiStyles, "text/css; charset=utf-8", 200)),
    HttpRouter.get("/ui/app.js", textResponse(uiScript, "application/javascript; charset=utf-8", 200)),
    HttpRouter.get(
      "/health",
      Effect.gen(function*(_) {
        const cwd = yield* _(resolveWorkspaceRoot(process.cwd()).pipe(Effect.orElseSucceed(() => process.cwd())))
        const projectsRoot = defaultProjectsRoot(cwd)
        return yield* _(jsonResponse({ ok: true, revision: controllerRevision, cwd, projectsRoot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    )
  )

  const withAuth = withUi.pipe(
    HttpRouter.get(
      "/auth/github/status",
      Effect.gen(function*(_) {
        const status = yield* _(readGithubAuthStatus())
        return yield* _(jsonResponse({ status }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/auth/menu",
      Effect.gen(function*(_) {
        const snapshot = yield* _(readAuthMenuSnapshot())
        return yield* _(jsonResponse({ snapshot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/github/login/stream",
      Effect.gen(function*(_) {
        const request = yield* _(readGithubAuthLoginRequest())
        const outputStream = yield* _(streamGithubAuthLogin(request))
        return HttpServerResponse.stream(outputStream, {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-cache"
          }
        })
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/github/login",
      Effect.gen(function*(_) {
        const request = yield* _(readGithubAuthLoginRequest())
        const status = yield* _(loginGithubAuth(request))
        return yield* _(jsonResponse({ ok: true, status }, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/menu",
      Effect.gen(function*(_) {
        const request = yield* _(readAuthMenuRequest())
        const snapshot = yield* _(runAuthMenuFlow(request))
        return yield* _(jsonResponse({ ok: true, snapshot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/terminal-sessions",
      Effect.gen(function*(_) {
        const request = yield* _(readAuthTerminalSessionRequest())
        const created = yield* _(createAuthTerminalSession(request))
        return yield* _(jsonResponse(created, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/auth/terminal-sessions/:sessionId/ws",
      terminalWebSocketUpgradeResponse.pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/auth/terminal-sessions/:sessionId",
      Effect.gen(function*(_) {
        const params = yield* _(authTerminalSessionParams)
        yield* _(deleteAuthTerminalSession(params.sessionId))
        return yield* _(jsonResponse({ ok: true }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/github/logout",
      Effect.gen(function*(_) {
        const request = yield* _(readGithubAuthLogoutRequest())
        const status = yield* _(logoutGithubAuth(request))
        return yield* _(jsonResponse({ ok: true, status }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/auth/codex/status",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const label = new URL(request.url, "http://localhost").searchParams.get("label")
        const status = yield* _(readCodexAuthStatus(label))
        return yield* _(jsonResponse({ status }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/codex/login",
      Effect.gen(function*(_) {
        const request = yield* _(readCodexAuthLoginRequest())
        const outputStream = yield* _(streamCodexAuthLogin(request))
        return HttpServerResponse.stream(outputStream, {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-cache"
          }
        })
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/codex/import",
      Effect.gen(function*(_) {
        const request = yield* _(readCodexAuthImportRequest())
        const status = yield* _(importCodexAuth(request))
        return yield* _(jsonResponse({ ok: true, status }, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/codex/logout",
      Effect.gen(function*(_) {
        const request = yield* _(readCodexAuthLogoutRequest())
        const status = yield* _(logoutCodexAuth(request))
        return yield* _(jsonResponse({ ok: true, status }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    )
  )

  const base = withAuth.pipe(
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

  const withState = base.pipe(
    HttpRouter.get(
      "/state/path",
      readStatePathOutput().pipe(
        Effect.flatMap((output) => jsonResponse({ output }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/state/init",
      Effect.gen(function*(_) {
        const request = yield* _(readStateInitRequest())
        const output = yield* _(initStateFromRequest(request))
        return yield* _(jsonResponse({ output }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/state/status",
      readStateStatusOutput().pipe(
        Effect.flatMap((output) => jsonResponse({ output }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/state/pull",
      pullState().pipe(
        Effect.flatMap((output) => jsonResponse({ output }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/state/commit",
      Effect.gen(function*(_) {
        const request = yield* _(readStateCommitRequest())
        const output = yield* _(commitStateFromRequest(request))
        return yield* _(jsonResponse({ output }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/state/sync",
      Effect.gen(function*(_) {
        const request = yield* _(readStateSyncRequest())
        const output = yield* _(syncStateFromRequest(request))
        return yield* _(jsonResponse({ output }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/state/push",
      pushState().pipe(
        Effect.flatMap((output) => jsonResponse({ output }, 200)),
        Effect.catchAll(errorResponse)
      )
    )
  )

  const withProjects = withState.pipe(
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
        const result = yield* _(createProjectFromRequest(request))
        return yield* _(
          "accepted" in result && result.accepted === true
            ? jsonResponse(result, 202)
            : jsonResponse({ project: result }, 201)
        )
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/projects/apply-all",
      Effect.gen(function*(_) {
        const request = yield* _(readApplyAllRequest())
        yield* _(applyAllProjects(request.activeOnly ?? false))
        return yield* _(jsonResponse({ ok: true }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/projects/down-all",
      downAllProjects().pipe(
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => getProject(projectId)),
        Effect.flatMap((project) => jsonResponse({ project }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/auth/menu",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) =>
          Effect.gen(function*(_) {
            const project = yield* _(getProject(projectId))
            const snapshot = yield* _(readProjectAuthSnapshot(project))
            return { snapshot }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/auth/menu",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(readProjectAuthRequest())
        const project = yield* _(getProject(projectId))
        const snapshot = yield* _(runProjectAuthFlow(project, request))
        return yield* _(jsonResponse({ ok: true, snapshot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/projects/:projectId/ports",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => listProjectPortForwards(projectId)),
        Effect.flatMap((forwards) => jsonResponse({ forwards }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/ports",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(readProjectPortForwardRequest())
        const serverRequest = yield* _(HttpServerRequest.HttpServerRequest)
        const forward = yield* _(createProjectPortForward(projectId, request, resolvePortPublicHost(serverRequest)))
        return yield* _(jsonResponse({ forward }, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/projects/:projectId/ports/:targetPort",
      projectPortForwardParams.pipe(
        Effect.flatMap(({ projectId, targetPort }) =>
          parsePortParam(targetPort).pipe(
            Effect.flatMap((port) => deleteProjectPortForward(projectId, port))
          )
        ),
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/browser",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const browser = yield* _(readProjectBrowserSession(projectId, resolveRequestOrigin(request)))
        return yield* _(jsonResponse({ browser }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    )
  )

  const withProjectDatabases = withProjects.pipe(
    HttpRouter.get(
      "/projects/:projectId/databases/profiles",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => listProjectDatabaseProfiles(projectId)),
        Effect.flatMap((profiles) => jsonResponse({ profiles }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/databases/forwards",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => listProjectDatabaseForwards(projectId)),
        Effect.flatMap((forwards) => jsonResponse({ forwards }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/databases/profiles",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(readProjectDatabaseProfileRequest())
        const profile = yield* _(saveProjectDatabaseProfile(projectId, request))
        return yield* _(jsonResponse({ profile }, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/projects/:projectId/databases/profiles/:profileId",
      projectDatabaseProfileParams.pipe(
        Effect.flatMap(({ projectId, profileId }) => deleteProjectDatabaseProfile(projectId, profileId)),
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/databases/profiles/:profileId/expose",
      Effect.gen(function*(_) {
        const { projectId, profileId } = yield* _(projectDatabaseProfileParams)
        const serverRequest = yield* _(HttpServerRequest.HttpServerRequest)
        const forward = yield* _(exposeProjectDatabaseProfile(
          projectId,
          profileId,
          resolvePortPublicHost(serverRequest)
        ))
        return yield* _(jsonResponse({ forward }, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/projects/:projectId/databases/profiles/:profileId/expose",
      projectDatabaseProfileParams.pipe(
        Effect.flatMap(({ projectId, profileId }) => deleteProjectDatabaseForward(projectId, profileId)),
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/databases/session",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => readProjectDatabaseSession(projectId)),
        Effect.flatMap((session) => jsonResponse({ session }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/databases/open",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => openProjectDatabaseEditor(projectId)),
        Effect.flatMap((session) => jsonResponse({ session }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/databases/restart",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => restartProjectDatabaseEditor(projectId)),
        Effect.flatMap((session) => jsonResponse({ session }, 200)),
        Effect.catchAll(errorResponse)
      )
    )
  )

  const withProjectLifecycle = withProjectDatabases.pipe(
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
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(readUpProjectRequest())
        const project = yield* _(
          upProject(projectId, request.authorizedKeysContents, request.useManagedAuthorizedKeys)
        )
        return yield* _(jsonResponse({ ok: true, project }, 200))
      }).pipe(
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
      "/projects/:projectId/terminal-sessions",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => createTerminalSession(projectId)),
        Effect.flatMap(({ project, session }) => jsonResponse({ ok: true, project, session }, 201)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/terminal-sessions/:sessionId/ws",
      terminalWebSocketUpgradeResponse.pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/projects/:projectId/terminal-sessions/:sessionId",
      terminalSessionParams.pipe(
        Effect.flatMap(({ projectId, sessionId }) => deleteTerminalSession(projectId, sessionId)),
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

  const withAgents = withProjectLifecycle.pipe(
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
      "/projects/:projectId/events-poll",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) =>
          Effect.gen(function*(_) {
            const request = yield* _(HttpServerRequest.HttpServerRequest)
            const hasCursor = hasQueryParam(request.url, "cursor")
            if (!hasCursor) {
              return {
                cursor: latestProjectCursor(projectId),
                events: []
              }
            }
            const currentCursor = parseQueryInt(request.url, "cursor", 0)
            const events = listProjectEventsSince(projectId, currentCursor)
            return {
              cursor: events[events.length - 1]?.seq ?? currentCursor,
              events
            }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
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
            const encodeComment = (comment: string): Uint8Array =>
              encoder.encode(`: ${comment}\n\n`)

            const poll = Effect.gen(function* (_) {
              const snapshotSent = yield* _(Ref.get(snapshotRef))

              if (!snapshotSent) {
                yield* _(Ref.set(snapshotRef, true))
                const cursor = latestProjectCursor(projectId)
                yield* _(Ref.set(cursorRef, cursor))
                return Chunk.fromIterable([
                  encodeComment(" ".repeat(2048)),
                  encodeSse("snapshot", {
                    projectId,
                    cursor,
                    agents: listAgents(projectId)
                  }, cursor),
                  encodeComment("connected")
                ])
              }

              const currentCursor = yield* _(Ref.get(cursorRef))
              const events = listProjectEventsSince(projectId, currentCursor)
              if (events.length === 0) {
                yield* _(Effect.sleep(Duration.millis(500)))
                return Chunk.of(encodeComment("keep-alive"))
              }

              const nextCursor = events[events.length - 1]?.seq ?? currentCursor
              yield* _(Ref.set(cursorRef, nextCursor))
              const encoded = events.map((event) => encodeSse(event.type, event, event.seq))
              return Chunk.fromIterable(encoded)
            })

            return HttpServerResponse.stream(Stream.repeatEffectChunk(poll), {
              headers: {
                "content-type": "text/event-stream; charset=utf-8",
                "cache-control": "no-cache, no-transform",
                "connection": "keep-alive",
                "x-accel-buffering": "no"
              }
            })
          })
        ),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.all(
      "*",
      projectProxyResponse.pipe(Effect.catchAll(errorResponse))
    )
  )
}
