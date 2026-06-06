import { Chunk, Duration, Effect, Match, Ref } from "effect"
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
import { federationJsonLdResponseContentType, type ApplyProjectRequest } from "./api/contracts.js"
import {
  AuthMenuRequestSchema,
  AuthTerminalSessionRequestSchema,
  ActiveProjectTerminalSessionRequestSchema,
  ApplyProjectRequestSchema,
  ApplyAllRequestSchema,
  CodexAuthImportRequestSchema,
  CodexAuthLoginRequestSchema,
  CodexAuthLogoutRequestSchema,
  CreateAgentRequestSchema,
  CreateFollowRequestSchema,
  CreateProjectRequestSchema,
  ExchangePollRequestSchema,
  ExchangeSubscribeRequestSchema,
  GitlabAuthLoginRequestSchema,
  GitlabAuthLogoutRequestSchema,
  GrokAuthLogoutRequestSchema,
  GithubAuthLoginRequestSchema,
  GithubAuthLogoutRequestSchema,
  ProjectDatabaseProfileRequestSchema,
  ProjectAuthRequestSchema,
  ProjectPortForwardRequestSchema,
  ProjectPromptUpdateRequestSchema,
  ProjectSkillUpdateRequestSchema,
  StartProjectTerminalSessionRequestSchema,
  StartPanelCloudflareTunnelRequestSchema,
  StateCommitRequestSchema,
  StateInitRequestSchema,
  StateSyncRequestSchema,
  UpProjectRequestSchema
} from "./api/schema.js"
import type { UpProjectRequestInput } from "./api/schema.js"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import { resolveWorkspaceRoot } from "@effect-template/lib/shell/workspace-root"
import {
  importCodexAuth,
  loginGitlabAuth,
  loginGithubAuth,
  logoutCodexAuth,
  logoutGrokAuth,
  logoutGitlabAuth,
  logoutGithubAuth,
  readCodexAuthStatus,
  readGrokAuthStatus,
  readGitlabAuthStatus,
  readGithubAuthStatus,
} from "./services/auth.js"
import { readAuthMenuSnapshot, runAuthMenuFlow } from "./services/auth-menu.js"
import { streamGitlabAuthLogin } from "./services/auth-gitlab-login-stream.js"
import { streamGithubAuthLogin } from "./services/auth-github-login-stream.js"
import { createAuthTerminalSession, deleteAuthTerminalSession } from "./services/auth-terminal-sessions.js"
import { streamCodexAuthLogin } from "./services/auth-codex-login-stream.js"
import { getAgent, getAgentAttachInfo, listAgents, readAgentLogs, startAgent, stopAgent } from "./services/agents.js"
import { readContainerTaskLogs, readContainerTaskSnapshot, stopContainerTask } from "./services/container-tasks.js"
import { latestProjectCursor, listProjectEventsSince } from "./services/events.js"
import {
  createFollowSubscription,
  ensureExchangeSubscription,
  ingestFederationInbox,
  listExchangeSubscriptions,
  listFederationIssues,
  listFollowSubscriptions,
  makeFederationContext,
  makeFederationExchangeStatus,
  pollExchangeOutboxes
} from "./services/federation.js"
import {
  fetchFedifyWebFinger,
  makeFedifyActorJsonLd,
  makeFedifyFollowersJsonLd,
  makeFedifyFollowersPageJsonLd,
  makeFedifyFollowingJsonLd,
  makeFedifyLikedJsonLd,
  makeFedifyOutboxJsonLd
} from "./services/fedify-federation.js"
import {
  applyAllProjects,
  applyProjectById,
  createProjectFromRequest,
  deleteProjectById,
  downAllProjects,
  downProject,
  getProject,
  getProjectItemByKey,
  listProjects,
  readProjectLogs,
  readProjectPs,
  recreateProject,
  resumeProject,
  suspendProject,
  upProject
} from "./services/projects.js"
import { readProjectAuthSnapshot, runProjectAuthFlow } from "./services/project-auth.js"
import {
  deleteProjectPrompt,
  readProjectPromptsSnapshot,
  writeProjectPrompt
} from "./services/project-prompts.js"
import type { ProjectPromptKind } from "./services/project-prompts.js"
import {
  deleteProjectSkill,
  readProjectSkillsSnapshot,
  writeProjectSkill
} from "./services/project-skills.js"
import type { ProjectSkillScope } from "./services/project-skills.js"
import { readProjectBrowserSession, startProjectBrowserSession, proxyProjectBrowser } from "./services/project-browser.js"
import { parseProjectBrowserProxyPath } from "./services/project-browser-core.js"
import {
  readPanelCloudflareTunnel,
  startPanelCloudflareTunnel,
  stopPanelCloudflareTunnel
} from "./services/panel-cloudflare-tunnel.js"
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
import {
  createTerminalSession,
  deleteTerminalSession,
  getProjectTerminalSession,
  listProjectTerminalSessions,
  lookupTerminalSessionById,
  readProjectTerminalSessions,
  readProjectTerminalImage,
  setProjectActiveTerminalSession,
  startTerminalSession
} from "./services/terminal-sessions.js"
import {
  connectSkillerWeb,
  openSkiller,
  openSkillerForTerminalSession,
  parseSkillerRoute,
  proxySkillerTrpc,
  readSkillerProjectContext,
  serveSkillerApp
} from "./services/skiller.js"
import {
  isSkillerWebCorsOriginAllowed,
  resolveDockerGitSkillerBackendUrl
} from "./services/skiller-core.js"
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

const ProjectKeyParamsSchema = Schema.Struct({
  projectKey: Schema.String
})

const ProjectPortForwardParamsSchema = Schema.Struct({
  projectId: Schema.String,
  targetPort: Schema.String
})

const ProjectDatabaseProfileParamsSchema = Schema.Struct({
  projectId: Schema.String,
  profileId: Schema.String
})

const ProjectPromptParamsSchema = Schema.Struct({
  projectId: Schema.String,
  kind: Schema.Literal("claude", "codex", "gemini", "grok")
})

const ProjectSkillParamsSchema = Schema.Struct({
  projectId: Schema.String,
  scopeId: Schema.String,
  name: Schema.String
})

const AgentParamsSchema = Schema.Struct({
  projectId: Schema.String,
  agentId: Schema.String
})

const TerminalSessionParamsSchema = Schema.Struct({
  projectId: Schema.String,
  sessionId: Schema.String
})

const TerminalSessionByProjectKeyParamsSchema = Schema.Struct({
  projectKey: Schema.String,
  sessionId: Schema.String
})

const ContainerTaskParamsSchema = Schema.Struct({
  projectId: Schema.String,
  pid: Schema.String
})

const AuthTerminalSessionParamsSchema = Schema.Struct({
  sessionId: Schema.String
})

const SkillerConnectRequestSchema = Schema.Struct({
  projectKey: Schema.String,
  sessionId: Schema.optional(Schema.String)
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

const binaryResponse = (data: Uint8Array, contentType: string, status = 200) =>
  Effect.succeed(
    HttpServerResponse.setStatus(
      HttpServerResponse.uint8Array(data, { contentType, headers: noStoreHeaders }),
      status
    )
  )

/**
 * Serializes a federation JSON-LD document with the ForgeFed response content type.
 *
 * @param data - JSON-LD payload that satisfies the JSON.stringify serializability precondition.
 * @param status - HTTP status code assigned to the response.
 * @returns Effect that yields an HTTP text response containing the serialized JSON-LD document.
 *
 * @pure false
 * @effect Delegates response allocation to textResponse and preserves no-store HTTP headers.
 * @invariant successful responses always use federationJsonLdResponseContentType.
 * @precondition data is JSON.stringify-serializable and status is a valid HTTP status code.
 * @postcondition response body equals JSON.stringify(data) and response status equals status.
 * @complexity O(n) time and O(n) space where n is the serialized JSON-LD payload size.
 * @throws TypeError when data violates the JSON.stringify serializability precondition.
 */
const jsonLdResponse = (data: unknown, status: number) =>
  textResponse(JSON.stringify(data), federationJsonLdResponseContentType, status)

const parseQueryInt = (url: string, key: string, fallback: number): number => {
  const parsed = Number(new URL(url, "http://localhost").searchParams.get(key) ?? "")
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.floor(parsed)
}

const hasQueryParam = (url: string, key: string): boolean =>
  new URL(url, "http://localhost").searchParams.has(key)

const readFollowersPageMode = (url: string): Effect.Effect<"collection" | "page", ApiBadRequestError> => {
  const page = new URL(url, "http://localhost").searchParams.get("page")
  if (page === null) {
    return Effect.succeed("collection")
  }
  return page === "1"
    ? Effect.succeed("page")
    : Effect.fail(new ApiBadRequestError({ message: `Unsupported followers page: ${page}` }))
}

const parsePortParam = (value: string): Effect.Effect<number, ApiBadRequestError> => {
  const parsed = Number.parseInt(value, 10)
  return String(parsed) === value && parsed > 0 && parsed <= 65_535
    ? Effect.succeed(parsed)
    : Effect.fail(new ApiBadRequestError({ message: `Invalid port: ${value}` }))
}

const parsePidParam = (value: string): Effect.Effect<number, ApiBadRequestError> => {
  const parsed = Number.parseInt(value, 10)
  return String(parsed) === value && parsed > 0
    ? Effect.succeed(parsed)
    : Effect.fail(new ApiBadRequestError({ message: `Invalid pid: ${value}` }))
}

const parseQueryBoolean = (url: string, key: string): boolean => {
  const value = new URL(url, "http://localhost").searchParams.get(key)
  return value === "1" || value === "true" || value === "yes"
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
const projectKeyParams = HttpRouter.schemaParams(ProjectKeyParamsSchema)
const projectPortForwardParams = HttpRouter.schemaParams(ProjectPortForwardParamsSchema)
const projectDatabaseProfileParams = HttpRouter.schemaParams(ProjectDatabaseProfileParamsSchema)
const projectPromptParams = HttpRouter.schemaParams(ProjectPromptParamsSchema)
const projectSkillParams = HttpRouter.schemaParams(ProjectSkillParamsSchema)
const agentParams = HttpRouter.schemaParams(AgentParamsSchema)
const terminalSessionParams = HttpRouter.schemaParams(TerminalSessionParamsSchema)
const terminalSessionByProjectKeyParams = HttpRouter.schemaParams(TerminalSessionByProjectKeyParamsSchema)
const containerTaskParams = HttpRouter.schemaParams(ContainerTaskParamsSchema)
const authTerminalSessionParams = HttpRouter.schemaParams(AuthTerminalSessionParamsSchema)

const readCreateProjectRequest = () => HttpServerRequest.schemaBodyJson(CreateProjectRequestSchema)
const readCreateFollowRequest = () => HttpServerRequest.schemaBodyJson(CreateFollowRequestSchema)
const readGithubAuthLoginRequest = () => HttpServerRequest.schemaBodyJson(GithubAuthLoginRequestSchema)
const readGithubAuthLogoutRequest = () => HttpServerRequest.schemaBodyJson(GithubAuthLogoutRequestSchema)
const readGitlabAuthLoginRequest = () => HttpServerRequest.schemaBodyJson(GitlabAuthLoginRequestSchema)
const readGitlabAuthLogoutRequest = () => HttpServerRequest.schemaBodyJson(GitlabAuthLogoutRequestSchema)
const readAuthMenuRequest = () => HttpServerRequest.schemaBodyJson(AuthMenuRequestSchema)
const readAuthTerminalSessionRequest = () => HttpServerRequest.schemaBodyJson(AuthTerminalSessionRequestSchema)
const readCodexAuthImportRequest = () => HttpServerRequest.schemaBodyJson(CodexAuthImportRequestSchema)
const readCodexAuthLoginRequest = () => HttpServerRequest.schemaBodyJson(CodexAuthLoginRequestSchema)
const readGrokAuthLogoutRequest = () => HttpServerRequest.schemaBodyJson(GrokAuthLogoutRequestSchema)
const readCodexAuthLogoutRequest = () => HttpServerRequest.schemaBodyJson(CodexAuthLogoutRequestSchema)
const readProjectAuthRequest = () => HttpServerRequest.schemaBodyJson(ProjectAuthRequestSchema)
const readSkillerConnectRequest = () => HttpServerRequest.schemaBodyJson(SkillerConnectRequestSchema)
const readProjectPromptUpdateRequest = () => HttpServerRequest.schemaBodyJson(ProjectPromptUpdateRequestSchema)
const readProjectSkillUpdateRequest = () => HttpServerRequest.schemaBodyJson(ProjectSkillUpdateRequestSchema)
const readActiveProjectTerminalSessionRequest = () =>
  HttpServerRequest.schemaBodyJson(ActiveProjectTerminalSessionRequestSchema)

const projectSkillScope = (scope: ProjectSkillScope): ProjectSkillScope => scope

const skillScopeFromId = (scopeId: string): ProjectSkillScope | null =>
  Match.value(scopeId).pipe(
    Match.when("skills", () => projectSkillScope("skills")),
    Match.when("agents-skills", () => projectSkillScope("agents/skills")),
    Match.when("agents-dot-skills", () => projectSkillScope("agents/.skills")),
    Match.when("claude-skills", () => projectSkillScope("claude/skills")),
    Match.when("codex-skills", () => projectSkillScope("codex/skills")),
    Match.when("gemini-skills", () => projectSkillScope("gemini/skills")),
    Match.when("grok-skills", () => projectSkillScope("grok/skills")),
    Match.orElse(() => null)
  )

export const skillScopeToId = (scope: ProjectSkillScope): string =>
  Match.value(scope).pipe(
    Match.when("skills", () => "skills"),
    Match.when("agents/skills", () => "agents-skills"),
    Match.when("agents/.skills", () => "agents-dot-skills"),
    Match.when("claude/skills", () => "claude-skills"),
    Match.when("codex/skills", () => "codex-skills"),
    Match.when("gemini/skills", () => "gemini-skills"),
    Match.when("grok/skills", () => "grok-skills"),
    Match.exhaustive
  )

const skillScopeFromBody = (scope: string): ProjectSkillScope | null =>
  Match.value(scope).pipe(
    Match.when("skills", () => projectSkillScope("skills")),
    Match.when("agents/skills", () => projectSkillScope("agents/skills")),
    Match.when("agents/.skills", () => projectSkillScope("agents/.skills")),
    Match.when("claude/skills", () => projectSkillScope("claude/skills")),
    Match.when("codex/skills", () => projectSkillScope("codex/skills")),
    Match.when("gemini/skills", () => projectSkillScope("gemini/skills")),
    Match.when("grok/skills", () => projectSkillScope("grok/skills")),
    Match.orElse(() => null)
  )
const readProjectPortForwardRequest = () => HttpServerRequest.schemaBodyJson(ProjectPortForwardRequestSchema)
const readStartPanelCloudflareTunnelRequest = () =>
  HttpServerRequest.schemaBodyJson(StartPanelCloudflareTunnelRequestSchema)
const readProjectDatabaseProfileRequest = () => HttpServerRequest.schemaBodyJson(ProjectDatabaseProfileRequestSchema)
const readStateInitRequest = () => HttpServerRequest.schemaBodyJson(StateInitRequestSchema)
const readStateCommitRequest = () => HttpServerRequest.schemaBodyJson(StateCommitRequestSchema)
const readStateSyncRequest = () => HttpServerRequest.schemaBodyJson(StateSyncRequestSchema)
const emptyApplyProjectRequest: ApplyProjectRequest = {}
const readApplyProjectRequest = () =>
  HttpServerRequest.schemaBodyJson(ApplyProjectRequestSchema).pipe(
    Effect.catchAll(() => Effect.succeed(emptyApplyProjectRequest))
  )
const readApplyAllRequest = () => HttpServerRequest.schemaBodyJson(ApplyAllRequestSchema)
const readExchangeSubscribeRequest = () => HttpServerRequest.schemaBodyJson(ExchangeSubscribeRequestSchema)
const emptyExchangePollRequest = {}
const readExchangePollRequest = () =>
  HttpServerRequest.schemaBodyJson(ExchangePollRequestSchema).pipe(
    Effect.catchAll(() => Effect.succeed(emptyExchangePollRequest))
  )
const emptyUpProjectRequest: UpProjectRequestInput = {}
const readUpProjectRequest = () =>
  HttpServerRequest.schemaBodyJson(UpProjectRequestSchema).pipe(
    Effect.catchAll(() => Effect.succeed(emptyUpProjectRequest))
  )
const readInboxPayload = () => HttpServerRequest.schemaBodyJson(Schema.Unknown)

/**
 * Selects the first trimmed, non-empty string from an ordered list.
 *
 * @param values - Candidate strings in priority order.
 * @returns The first trimmed non-empty candidate, or undefined when none exist.
 *
 * @pure true
 * @effect none
 * @invariant result === undefined || result.length > 0
 * @precondition values is a readonly array of strings or undefined entries.
 * @postcondition result is the first trimmed non-empty value in values, otherwise undefined.
 * @complexity O(n * m) time where n is values.length and m is average trim cost; O(1) space.
 * @throws Never
 */
const firstNonEmptyEnv = (
  values: ReadonlyArray<string | undefined>
): string | undefined => {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed
    }
  }
  return undefined
}

/**
 * Resolves the configured federation public origin from environment variables.
 *
 * @param env - Environment map containing optional docker-git public origin keys.
 * @returns The first non-empty configured public origin, or undefined.
 *
 * @pure true
 * @effect none; delegates deterministic selection to firstNonEmptyEnv.
 * @invariant result belongs to trimmed env values for DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN or DOCKER_GIT_API_PUBLIC_URL, or is undefined.
 * @precondition env is a Record<string, string | undefined>.
 * @postcondition result equals the first non-empty value from federation origin keys in priority order, otherwise undefined.
 * @complexity O(k * m) time for k configured keys and average trim cost m; O(1) space.
 * @throws Never
 */
export const resolveConfiguredFederationPublicOrigin = (
  env: Record<string, string | undefined>
): string | undefined =>
  firstNonEmptyEnv([
    env["DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN"],
    env["DOCKER_GIT_API_PUBLIC_URL"]
  ])

const configuredFederationPublicOrigin =
  resolveConfiguredFederationPublicOrigin(process.env)

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

const resolveSkillerBackendUrl = (request: HttpServerRequest.HttpServerRequest): string =>
  resolveDockerGitSkillerBackendUrl(process.env, resolveRequestOrigin(request))

const skillerCorsHeaders = (
  request: HttpServerRequest.HttpServerRequest
): Record<string, string> => {
  const origin = readHeader(request, "origin")
  if (origin === undefined || !isSkillerWebCorsOriginAllowed(origin, process.env)) {
    return {}
  }
  return {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": readHeader(request, "access-control-request-headers") ??
      "content-type,trpc-accept,x-trpc-source",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": origin,
    "access-control-max-age": "600",
    "access-control-expose-headers": "content-type",
    vary: "origin"
  }
}

const withSkillerCors = (
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse
): HttpServerResponse.HttpServerResponse => {
  const headers = skillerCorsHeaders(request)
  return Object.keys(headers).length === 0 ? response : HttpServerResponse.setHeaders(response, headers)
}

const skillerJsonResponse = (
  request: HttpServerRequest.HttpServerRequest,
  data: unknown,
  status: number
) =>
  jsonResponse(data, status).pipe(
    Effect.map((response) => withSkillerCors(request, response))
  )

const skillerErrorResponse = (
  request: HttpServerRequest.HttpServerRequest,
  error: unknown
) =>
  errorResponse(error).pipe(
    Effect.map((response) => withSkillerCors(request, response))
  )

const isSkillerCorsPath = (pathname: string): boolean => {
  const normalized = pathname.startsWith("/api/") ? pathname.slice("/api".length) : pathname
  return normalized === "/skiller/connect" || parseSkillerRoute(pathname) !== null
}

const skillerCorsPreflightResponse = (
  request: HttpServerRequest.HttpServerRequest
) => {
  const origin = readHeader(request, "origin")
  const allowed = origin === undefined || isSkillerWebCorsOriginAllowed(origin, process.env)
  return Effect.succeed(HttpServerResponse.empty({
    headers: allowed ? skillerCorsHeaders(request) : noStoreHeaders,
    status: allowed ? 204 : 403
  }))
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

/**
 * Builds the federation status HTTP handler shared by public and compatibility routes.
 *
 * @pure false
 * @effect Reads HttpServerRequest, resolves federation context, renders makeFederationExchangeStatus, serializes with jsonResponse, and maps failures through errorResponse.
 * @invariant same request context produces the same federation status payload for every route alias.
 * @precondition request headers or configured env provide a non-empty public origin.
 * @postcondition successful responses contain federation exchange status JSON with HTTP 200.
 * @complexity O(s + e log e) time where s is subscription count and e is event count; O(s + e) space.
 * @throws Never; failures are represented through the Effect error channel and converted by errorResponse.
 */
export const federationExchangeStatusResponse = () =>
  Effect.gen(function*(_) {
    const request = yield* _(HttpServerRequest.HttpServerRequest)
    const context = yield* _(resolveFederationContext(request))
    return yield* _(jsonResponse(makeFederationExchangeStatus(context), 200))
  }).pipe(Effect.catchAll(errorResponse))

/**
 * Builds the federation actor JSON-LD HTTP handler.
 *
 * @returns Effect that yields the local ActivityPub actor document response.
 *
 * @pure false
 * @effect Reads HttpServerRequest, resolves federation context, renders a Fedify Person, serializes with jsonLdResponse, and maps failures through errorResponse.
 * @invariant successful responses contain the actor id derived from the resolved federation context.
 * @precondition request headers or configured env provide a non-empty public origin.
 * @postcondition successful responses contain a JSON-LD Person document with HTTP 200.
 * @complexity O(1) time and O(1) space for document construction, excluding serialization size.
 * @throws Never; failures are represented through the Effect error channel and converted by errorResponse.
 */
export const federationActorDocumentResponse = () =>
  Effect.gen(function*(_) {
    const request = yield* _(HttpServerRequest.HttpServerRequest)
    const context = yield* _(resolveFederationContext(request))
    const document = yield* _(makeFedifyActorJsonLd(context))
    return yield* _(jsonLdResponse(document, 200))
  }).pipe(Effect.catchAll(errorResponse))

/**
 * Builds the federation outbox JSON-LD HTTP handler.
 *
 * @returns Effect that yields the local ActivityPub outbox collection response.
 *
 * @pure false
 * @effect Reads HttpServerRequest, resolves federation context, renders a Fedify OrderedCollection, serializes with jsonLdResponse, and maps failures through errorResponse.
 * @invariant successful responses contain the outbox id derived from the resolved federation context.
 * @precondition request headers or configured env provide a non-empty public origin.
 * @postcondition successful responses contain a JSON-LD OrderedCollection document with HTTP 200.
 * @complexity O(1) time and O(1) space for document construction, excluding serialization size.
 * @throws Never; failures are represented through the Effect error channel and converted by errorResponse.
 */
export const federationOutboxDocumentResponse = () =>
  Effect.gen(function*(_) {
    const request = yield* _(HttpServerRequest.HttpServerRequest)
    const context = yield* _(resolveFederationContext(request))
    const document = yield* _(makeFedifyOutboxJsonLd(context))
    return yield* _(jsonLdResponse(document, 200))
  }).pipe(Effect.catchAll(errorResponse))

/**
 * Builds the federation followers JSON-LD HTTP handler.
 *
 * @returns Effect that yields the local ActivityPub followers collection response.
 *
 * @pure false
 * @effect Reads HttpServerRequest, resolves federation context, renders a Fedify OrderedCollection/Page, serializes with jsonLdResponse, and maps failures through errorResponse.
 * @invariant successful responses contain the followers id derived from the resolved federation context.
 * @precondition request headers or configured env provide a non-empty public origin.
 * @postcondition successful responses contain a JSON-LD OrderedCollection document with HTTP 200.
 * @complexity O(1) time and O(1) space for document construction, excluding serialization size.
 * @throws Never; failures are represented through the Effect error channel and converted by errorResponse.
 */
export const federationFollowersDocumentResponse = () =>
  Effect.gen(function*(_) {
    const request = yield* _(HttpServerRequest.HttpServerRequest)
    const context = yield* _(resolveFederationContext(request))
    const mode = yield* _(readFollowersPageMode(request.url))
    const document = yield* _(
      mode === "page"
        ? makeFedifyFollowersPageJsonLd(context)
        : makeFedifyFollowersJsonLd(context)
    )
    return yield* _(jsonLdResponse(document, 200))
  }).pipe(Effect.catchAll(errorResponse))

/**
 * Builds the federation following JSON-LD HTTP handler.
 *
 * @returns Effect that yields the local ActivityPub following collection response.
 *
 * @pure false
 * @effect Reads HttpServerRequest, resolves federation context, renders a Fedify OrderedCollection, serializes with jsonLdResponse, and maps failures through errorResponse.
 * @invariant successful responses contain the following id derived from the resolved federation context.
 * @precondition request headers or configured env provide a non-empty public origin.
 * @postcondition successful responses contain a JSON-LD OrderedCollection document with HTTP 200.
 * @complexity O(1) time and O(1) space for document construction, excluding serialization size.
 * @throws Never; failures are represented through the Effect error channel and converted by errorResponse.
 */
export const federationFollowingDocumentResponse = () =>
  Effect.gen(function*(_) {
    const request = yield* _(HttpServerRequest.HttpServerRequest)
    const context = yield* _(resolveFederationContext(request))
    const document = yield* _(makeFedifyFollowingJsonLd(context))
    return yield* _(jsonLdResponse(document, 200))
  }).pipe(Effect.catchAll(errorResponse))

/**
 * Builds the federation liked JSON-LD HTTP handler.
 *
 * @returns Effect that yields the local ActivityPub liked collection response.
 *
 * @pure false
 * @effect Reads HttpServerRequest, resolves federation context, renders a Fedify OrderedCollection, serializes with jsonLdResponse, and maps failures through errorResponse.
 * @invariant successful responses contain the liked collection id derived from the resolved federation context.
 * @precondition request headers or configured env provide a non-empty public origin.
 * @postcondition successful responses contain a JSON-LD OrderedCollection document with HTTP 200.
 * @complexity O(1) time and O(1) space for document construction, excluding serialization size.
 * @throws Never; failures are represented through the Effect error channel and converted by errorResponse.
 */
export const federationLikedDocumentResponse = () =>
  Effect.gen(function*(_) {
    const request = yield* _(HttpServerRequest.HttpServerRequest)
    const context = yield* _(resolveFederationContext(request))
    const document = yield* _(makeFedifyLikedJsonLd(context))
    return yield* _(jsonLdResponse(document, 200))
  }).pipe(Effect.catchAll(errorResponse))

export const federationWebFingerResponse = () =>
  Effect.gen(function*(_) {
    const request = yield* _(HttpServerRequest.HttpServerRequest)
    const context = yield* _(resolveFederationContext(request))
    const webRequest = yield* _(HttpServerRequest.toWeb(request))
    const response = yield* _(fetchFedifyWebFinger(webRequest, context))
    return HttpServerResponse.fromWeb(response)
  }).pipe(Effect.catchAll(errorResponse))

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
  if (request.method === "OPTIONS" && isSkillerCorsPath(pathname)) {
    return yield* _(skillerCorsPreflightResponse(request))
  }
  const skillerRoute = parseSkillerRoute(pathname)
  if (skillerRoute !== null) {
    if (skillerRoute._tag === "App") {
      return yield* _(
        serveSkillerApp(skillerRoute).pipe(
          Effect.map((response) => withSkillerCors(request, response)),
          Effect.catchAll((error) => skillerErrorResponse(request, error))
        )
      )
    }
    return yield* _(
      proxySkillerTrpc(request, skillerRoute).pipe(
        Effect.map((response) => withSkillerCors(request, response)),
        Effect.catchAll((error) => skillerErrorResponse(request, error))
      )
    )
  }
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

const normalizedOptionalString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

const skillerConnectInfoResponse = (
  request: HttpServerRequest.HttpServerRequest
) =>
  listProjects().pipe(
    Effect.flatMap((projects) => skillerJsonResponse(request, { ok: true, projects }, 200)),
    Effect.catchAll((error) => skillerErrorResponse(request, error))
  )

const skillerConnectResponse = (
  request: HttpServerRequest.HttpServerRequest
) =>
  Effect.gen(function*(_) {
    const body = yield* _(readSkillerConnectRequest())
    const projectKey = body.projectKey.trim()
    if (projectKey.length === 0) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: "projectKey is required." })))
    }
    const connection = yield* _(connectSkillerWeb(
      projectKey,
      normalizedOptionalString(body.sessionId),
      resolveSkillerBackendUrl(request)
    ))
    return yield* _(skillerJsonResponse(request, { ok: true, ...connection }, 202))
  }).pipe(
    Effect.catchAll((error) => skillerErrorResponse(request, error))
  )

export const makeRouter = () => {
  const withCoreRoutes = HttpRouter.empty.pipe(
    HttpRouter.get(
      "/health",
      Effect.gen(function*(_) {
        const cwd = yield* _(resolveWorkspaceRoot(process.cwd()).pipe(Effect.orElseSucceed(() => process.cwd())))
        const projectsRoot = defaultProjectsRoot(cwd)
        return yield* _(jsonResponse({ ok: true, revision: controllerRevision, cwd, projectsRoot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/skiller/connect",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        return yield* _(skillerConnectInfoResponse(request))
      })
    ),
    HttpRouter.get(
      "/api/skiller/connect",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        return yield* _(skillerConnectInfoResponse(request))
      })
    ),
    HttpRouter.post(
      "/skiller/connect",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        return yield* _(skillerConnectResponse(request))
      })
    ),
    HttpRouter.post(
      "/api/skiller/connect",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        return yield* _(skillerConnectResponse(request))
      })
    ),
    HttpRouter.post(
      "/skiller/open",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const launch = yield* _(openSkiller(undefined, undefined, resolveSkillerBackendUrl(request)))
        return yield* _(jsonResponse({ ok: true, ...launch }, 202))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/projects/by-key/:projectKey/skiller/open",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const { projectKey } = yield* _(projectKeyParams)
        const launch = yield* _(openSkiller(projectKey, undefined, resolveSkillerBackendUrl(request)))
        return yield* _(jsonResponse({ ok: true, ...launch }, 202))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/projects/by-key/:projectKey/terminal-sessions/:sessionId/skiller/open",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const { projectKey, sessionId } = yield* _(terminalSessionByProjectKeyParams)
        const launch = yield* _(openSkillerForTerminalSession(projectKey, sessionId, resolveSkillerBackendUrl(request)))
        return yield* _(jsonResponse({ ok: true, ...launch }, 202))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/projects/by-key/:projectKey/skiller/context",
      projectKeyParams.pipe(
        Effect.flatMap(({ projectKey }) => readSkillerProjectContext(projectKey, null)),
        Effect.flatMap((context) => jsonResponse({ ok: true, ...context }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/by-key/:projectKey/terminal-sessions/:sessionId/skiller/context",
      terminalSessionByProjectKeyParams.pipe(
        Effect.flatMap(({ projectKey, sessionId }) => readSkillerProjectContext(projectKey, sessionId)),
        Effect.flatMap((context) => jsonResponse({ ok: true, ...context }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/cloudflare-tunnels/panel",
      readPanelCloudflareTunnel().pipe(
        Effect.flatMap((tunnel) => jsonResponse({ tunnel }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/cloudflare-tunnels/panel",
      Effect.gen(function*(_) {
        const request = yield* _(readStartPanelCloudflareTunnelRequest())
        const tunnel = yield* _(startPanelCloudflareTunnel(request))
        return yield* _(jsonResponse({ tunnel }, 202))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/cloudflare-tunnels/panel",
      stopPanelCloudflareTunnel().pipe(
        Effect.flatMap((tunnel) => jsonResponse({ tunnel }, 200)),
        Effect.catchAll(errorResponse)
      )
    )
  )

  const withAuth = withCoreRoutes.pipe(
    HttpRouter.get(
      "/auth/github/status",
      Effect.gen(function*(_) {
        const status = yield* _(readGithubAuthStatus())
        return yield* _(jsonResponse({ status }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/auth/gitlab/status",
      Effect.gen(function*(_) {
        const status = yield* _(readGitlabAuthStatus())
        return yield* _(jsonResponse({ status }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/auth/grok/status",
      Effect.gen(function*(_) {
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const label = new URL(request.url, "http://localhost").searchParams.get("label")
        const status = yield* _(readGrokAuthStatus(label))
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
      "/auth/gitlab/login/stream",
      Effect.gen(function*(_) {
        const request = yield* _(readGitlabAuthLoginRequest())
        const outputStream = yield* _(streamGitlabAuthLogin(request))
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
      "/auth/gitlab/login",
      Effect.gen(function*(_) {
        const request = yield* _(readGitlabAuthLoginRequest())
        const status = yield* _(loginGitlabAuth(request))
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
    HttpRouter.get(
      "/terminal-sessions/:sessionId",
      Effect.gen(function*(_) {
        const params = yield* _(authTerminalSessionParams)
        const session = yield* _(lookupTerminalSessionById(params.sessionId))
        return yield* _(jsonResponse(session, 200))
      }).pipe(Effect.catchAll(errorResponse))
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
    HttpRouter.post(
      "/auth/gitlab/logout",
      Effect.gen(function*(_) {
        const request = yield* _(readGitlabAuthLogoutRequest())
        const status = yield* _(logoutGitlabAuth(request))
        return yield* _(jsonResponse({ ok: true, status }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/auth/grok/logout",
      Effect.gen(function*(_) {
        const request = yield* _(readGrokAuthLogoutRequest())
        const status = yield* _(logoutGrokAuth(request))
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
      "/.well-known/webfinger",
      federationWebFingerResponse()
    ),
    HttpRouter.get(
      "/federation/actor",
      federationActorDocumentResponse()
    ),
    HttpRouter.get(
      "/federation/outbox",
      federationOutboxDocumentResponse()
    ),
    HttpRouter.get(
      "/federation/followers",
      federationFollowersDocumentResponse()
    ),
    HttpRouter.get(
      "/federation/following",
      federationFollowingDocumentResponse()
    ),
    HttpRouter.get(
      "/federation/liked",
      federationLikedDocumentResponse()
    ),
    HttpRouter.get(
      "/federation/status",
      federationExchangeStatusResponse()
    ),
    HttpRouter.get(
      "/federation/exchange/status",
      federationExchangeStatusResponse()
    ),
    HttpRouter.post(
      "/federation/exchange/subscriptions",
      Effect.gen(function*(_) {
        const requestBody = yield* _(readExchangeSubscribeRequest())
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const context = yield* _(resolveFederationContext(request, requestBody.domain))
        const created = yield* _(ensureExchangeSubscription(requestBody, context))
        return yield* _(jsonResponse(created, 201))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/federation/exchange/subscriptions",
      Effect.sync(() => ({ subscriptions: listExchangeSubscriptions() })).pipe(
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/federation/exchange/poll",
      Effect.gen(function*(_) {
        const requestBody = yield* _(readExchangePollRequest())
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const context = yield* _(resolveFederationContext(request))
        const result = yield* _(pollExchangeOutboxes(requestBody, context))
        return yield* _(jsonResponse({ result }, 200))
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
      "/projects/:projectId/prompts",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) =>
          Effect.gen(function*(_) {
            const project = yield* _(getProject(projectId))
            const snapshot = yield* _(readProjectPromptsSnapshot(project))
            return { snapshot }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.put(
      "/projects/:projectId/prompts/:kind",
      Effect.gen(function*(_) {
        const { projectId, kind } = yield* _(projectPromptParams)
        const request = yield* _(readProjectPromptUpdateRequest())
        const project = yield* _(getProject(projectId))
        const prompt = yield* _(writeProjectPrompt(project, kind as ProjectPromptKind, request.content))
        const snapshot = yield* _(readProjectPromptsSnapshot(project))
        return yield* _(jsonResponse({ ok: true, prompt, snapshot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/projects/:projectId/prompts/:kind",
      Effect.gen(function*(_) {
        const { projectId, kind } = yield* _(projectPromptParams)
        const project = yield* _(getProject(projectId))
        yield* _(deleteProjectPrompt(project, kind as ProjectPromptKind))
        const snapshot = yield* _(readProjectPromptsSnapshot(project))
        return yield* _(jsonResponse({ ok: true, snapshot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/projects/:projectId/skills",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) =>
          Effect.gen(function*(_) {
            const project = yield* _(getProject(projectId))
            const snapshot = yield* _(readProjectSkillsSnapshot(project))
            return { snapshot }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/skills",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(readProjectSkillUpdateRequest())
        const scope = skillScopeFromBody(request.scope)
        if (scope === null) {
          return yield* _(
            Effect.fail(new ApiBadRequestError({ message: `Unknown skill scope: ${request.scope}` }))
          )
        }
        const project = yield* _(getProject(projectId))
        const skill = yield* _(writeProjectSkill(project, scope, request.name, request.content))
        const snapshot = yield* _(readProjectSkillsSnapshot(project))
        return yield* _(jsonResponse({ ok: true, skill, snapshot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/projects/:projectId/skills/:scopeId/:name",
      Effect.gen(function*(_) {
        const { projectId, scopeId, name } = yield* _(projectSkillParams)
        const scope = skillScopeFromId(scopeId)
        if (scope === null) {
          return yield* _(
            Effect.fail(new ApiBadRequestError({ message: `Unknown skill scope: ${scopeId}` }))
          )
        }
        const project = yield* _(getProject(projectId))
        yield* _(deleteProjectSkill(project, scope, name))
        const snapshot = yield* _(readProjectSkillsSnapshot(project))
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
    ),
    HttpRouter.post(
      "/projects/:projectId/browser/start",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const browser = yield* _(startProjectBrowserSession(projectId, resolveRequestOrigin(request)))
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

  const withProjectLifecycleBase = withProjectDatabases.pipe(
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
      "/projects/:projectId/resume",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => resumeProject(projectId)),
        Effect.flatMap((project) => jsonResponse({ ok: true, project }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/apply",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(readApplyProjectRequest())
        const project = yield* _(applyProjectById(projectId, request))
        return yield* _(jsonResponse({ ok: true, project }, 200))
      }).pipe(
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/:projectId/suspend",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) => suspendProject(projectId)),
        Effect.flatMap((project) => jsonResponse({ ok: true, project }, 200)),
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
    )
  )

  const withProjectLifecycle = withProjectLifecycleBase.pipe(
    HttpRouter.post(
      "/projects/by-key/:projectKey/terminal-sessions",
      projectKeyParams.pipe(
        Effect.flatMap(({ projectKey }) =>
          getProjectItemByKey(projectKey).pipe(
            Effect.flatMap((project) => createTerminalSession(project.projectDir))
          )
        ),
        Effect.flatMap(({ project, session }) => jsonResponse({ ok: true, project, session }, 201)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/by-key/:projectKey/terminal-sessions",
      projectKeyParams.pipe(
        Effect.flatMap(({ projectKey }) =>
          getProjectItemByKey(projectKey).pipe(
            Effect.flatMap((project) => readProjectTerminalSessions(project.projectDir))
          )
        ),
        Effect.flatMap((body) => jsonResponse(body, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/by-key/:projectKey/terminal-sessions/:sessionId",
      terminalSessionByProjectKeyParams.pipe(
        Effect.flatMap(({ projectKey, sessionId }) =>
          getProjectItemByKey(projectKey).pipe(
            Effect.flatMap((project) => getProjectTerminalSession(project.projectDir, sessionId))
          )
        ),
        Effect.flatMap((session) => jsonResponse({ session }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/by-key/:projectKey/terminal-sessions/:sessionId/ws",
      terminalWebSocketUpgradeResponse.pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.del(
      "/projects/by-key/:projectKey/terminal-sessions/:sessionId",
      terminalSessionByProjectKeyParams.pipe(
        Effect.flatMap(({ projectKey, sessionId }) =>
          getProjectItemByKey(projectKey).pipe(
            Effect.flatMap((project) => deleteTerminalSession(project.projectDir, sessionId))
          )
        ),
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
      "/projects/:projectId/terminal-sessions",
      projectParams.pipe(
        Effect.flatMap(({ projectId }) =>
          listProjectTerminalSessions(projectId).pipe(
            Effect.map((sessions) => ({ sessions }))
          )
        ),
        Effect.flatMap((body) => jsonResponse(body, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/terminal-sessions/:sessionId",
      terminalSessionParams.pipe(
        Effect.flatMap(({ projectId, sessionId }) => getProjectTerminalSession(projectId, sessionId)),
        Effect.flatMap((session) => jsonResponse({ session }, 200)),
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
    HttpRouter.get(
      "/projects/:projectId/tasks",
      Effect.gen(function*(_) {
        const { projectId } = yield* _(projectParams)
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const snapshot = yield* _(readContainerTaskSnapshot(projectId, parseQueryBoolean(request.url, "includeDefault")))
        return yield* _(jsonResponse({ snapshot }, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.post(
      "/projects/:projectId/tasks/:pid/stop",
      containerTaskParams.pipe(
        Effect.flatMap(({ projectId, pid }) =>
          parsePidParam(pid).pipe(
            Effect.flatMap((taskPid) => stopContainerTask(projectId, taskPid))
          )
        ),
        Effect.flatMap(() => jsonResponse({ ok: true }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/tasks/:pid/logs",
      Effect.gen(function*(_) {
        const { projectId, pid } = yield* _(containerTaskParams)
        const taskPid = yield* _(parsePidParam(pid))
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const output = yield* _(readContainerTaskLogs(projectId, taskPid, parseQueryInt(request.url, "lines", 200)))
        return yield* _(jsonResponse({ output }, 200))
      }).pipe(Effect.catchAll(errorResponse))
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

  const withProjectTerminalStart = withProjectLifecycle.pipe(
    HttpRouter.put(
      "/projects/by-key/:projectKey/terminal-sessions/active",
      Effect.gen(function*(_) {
        const { projectKey } = yield* _(projectKeyParams)
        const request = yield* _(readActiveProjectTerminalSessionRequest())
        const project = yield* _(getProjectItemByKey(projectKey))
        const session = yield* _(setProjectActiveTerminalSession(project.projectDir, request.sessionId))
        return yield* _(jsonResponse({ ok: true, session }, 200))
      }).pipe(
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/projects/by-key/:projectKey/terminal-sessions/start",
      projectKeyParams.pipe(
        Effect.flatMap(({ projectKey }) =>
          Effect.gen(function*(_) {
            const request = yield* _(HttpServerRequest.schemaBodyJson(StartProjectTerminalSessionRequestSchema))
            const project = yield* _(getProjectItemByKey(projectKey))
            return yield* _(startTerminalSession(project.projectDir, request.requestId))
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 202)),
        Effect.catchAll(errorResponse)
      )
    )
  )

  const withProjectTerminalImages = withProjectTerminalStart.pipe(
    HttpRouter.get(
      "/projects/by-key/:projectKey/terminal-sessions/:sessionId/image",
      Effect.gen(function*(_) {
        const { projectKey, sessionId } = yield* _(terminalSessionByProjectKeyParams)
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const imagePath = new URL(request.url, "http://localhost").searchParams.get("path") ?? ""
        const project = yield* _(getProjectItemByKey(projectKey))
        const result = yield* _(readProjectTerminalImage(project.projectDir, sessionId, imagePath))
        return yield* _(binaryResponse(result.bytes, result.mediaType, 200))
      }).pipe(Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/projects/:projectId/terminal-sessions/:sessionId/image",
      Effect.gen(function*(_) {
        const { projectId, sessionId } = yield* _(terminalSessionParams)
        const request = yield* _(HttpServerRequest.HttpServerRequest)
        const imagePath = new URL(request.url, "http://localhost").searchParams.get("path") ?? ""
        const result = yield* _(readProjectTerminalImage(projectId, sessionId, imagePath))
        return yield* _(binaryResponse(result.bytes, result.mediaType, 200))
      }).pipe(Effect.catchAll(errorResponse))
    )
  )

  const withAgents = withProjectTerminalImages.pipe(
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
