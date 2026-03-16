import * as HttpBody from "@effect/platform/HttpBody"
import * as HttpClient from "@effect/platform/HttpClient"
import type * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import { isInsideDocker } from "@effect-template/lib"
import { Data, Effect } from "effect"
import * as Schema from "effect/Schema"

// CHANGE: HTTP client for the unified REST API
// WHY: CLI becomes a thin HTTP frontend; all business logic runs in the API server
// QUOTE(ТЗ): "CLI → DOCKER_GIT_API_URL → REST API"
// PURITY: SHELL
// EFFECT: Effect<T, ApiClientError, HttpClient.HttpClient>
// INVARIANT: ∀ cmd ∈ CLICommands \ {Attach, Panes, Menu}: handler(cmd) = httpCall(apiEndpoint(cmd))
// COMPLEXITY: O(1) per request

export class ApiClientError extends Data.TaggedError("ApiClientError")<{
  readonly message: string
}> {}

// CHANGE: trim trailing slashes without backtracking regex; resolve DinD API host
// WHY: in DinD, localhost:3334 is on the outer host; use docker-git-api:3334 via Docker DNS
// PURITY: CORE
// COMPLEXITY: O(n) where n = number of trailing slashes (typically 0 or 1)
const resolveApiBaseUrl = (): string => {
  const defaultUrl = isInsideDocker() ? "http://docker-git-api:3334" : "http://localhost:3334"
  const raw = process.env["DOCKER_GIT_API_URL"] ?? defaultUrl
  const trimmed = raw.trim()
  let end = trimmed.length
  while (end > 0 && trimmed[end - 1] === "/") {
    end--
  }
  return trimmed.slice(0, end)
}

const handleResponse = <T>(
  response: HttpClientResponse.HttpClientResponse,
  schema: Schema.Schema<T>
): Effect.Effect<T, ApiClientError> =>
  Effect.gen(function*(_) {
    if (response.status >= 400) {
      const text = yield* _(
        response.text.pipe(
          Effect.mapError((e) => new ApiClientError({ message: String(e) }))
        )
      )
      return yield* _(
        Effect.fail(new ApiClientError({ message: `HTTP ${response.status}: ${text}` }))
      )
    }
    const json = yield* _(
      response.json.pipe(
        Effect.mapError((e) => new ApiClientError({ message: String(e) }))
      )
    )
    return yield* _(
      Schema.decodeUnknown(schema)(json).pipe(
        Effect.mapError((e) => new ApiClientError({ message: `Response parse error: ${String(e)}` }))
      )
    )
  })

const apiPost = <T>(
  path: string,
  body: object,
  schema: Schema.Schema<T>
): Effect.Effect<T, ApiClientError, HttpClient.HttpClient> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const url = `${resolveApiBaseUrl()}${path}`
    const response = yield* _(
      client.post(url, { body: HttpBody.unsafeJson(body) }).pipe(
        Effect.mapError((e) => new ApiClientError({ message: String(e) }))
      )
    )
    return yield* _(handleResponse(response, schema))
  })

const apiGet = <T>(
  path: string,
  schema: Schema.Schema<T>
): Effect.Effect<T, ApiClientError, HttpClient.HttpClient> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const url = `${resolveApiBaseUrl()}${path}`
    const response = yield* _(
      client.get(url).pipe(
        Effect.mapError((e) => new ApiClientError({ message: String(e) }))
      )
    )
    return yield* _(handleResponse(response, schema))
  })

// ─── Response schemas ───────────────────────────────────────────────────────

const AuthStatusResponseSchema = Schema.Struct({ message: Schema.String })

const StatePathResponseSchema = Schema.Struct({ path: Schema.String })

const StateOutputResponseSchema = Schema.Struct({ output: Schema.String })

const SessionsOutputSchema = Schema.Struct({ output: Schema.String })

const OkResponseSchema = Schema.Struct({ ok: Schema.Boolean })

const ProjectSummarySchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  repoUrl: Schema.String,
  repoRef: Schema.String,
  status: Schema.String,
  statusLabel: Schema.String
})

const ProjectDetailsSchema = Schema.Struct({
  ...ProjectSummarySchema.fields,
  containerName: Schema.String,
  serviceName: Schema.String,
  sshUser: Schema.String,
  sshPort: Schema.Number,
  targetDir: Schema.String,
  projectDir: Schema.String,
  sshCommand: Schema.String,
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  codexAuthPath: Schema.String,
  codexHome: Schema.String
})

const ProjectsListResponseSchema = Schema.Struct({
  projects: Schema.Array(ProjectSummarySchema)
})

const ProjectCreatedResponseSchema = Schema.Struct({
  project: ProjectDetailsSchema
})

const ApplyResultSchema = Schema.Struct({
  applied: Schema.Boolean,
  containerName: Schema.String
})

// ─── Auth endpoints ──────────────────────────────────────────────────────────

export const apiAuthGithubLogin = (req: {
  readonly label?: string | null
  readonly token?: string | null
  readonly scopes?: string | null
  readonly envGlobalPath: string
}) => apiPost("/auth/github/login", req, AuthStatusResponseSchema)

export const apiAuthGithubStatus = (req: { readonly envGlobalPath: string }) =>
  apiPost("/auth/github/status", req, AuthStatusResponseSchema)

export const apiAuthGithubLogout = (req: { readonly label?: string | null; readonly envGlobalPath: string }) =>
  apiPost("/auth/github/logout", req, AuthStatusResponseSchema)

export const apiAuthCodexLogin = (req: { readonly label?: string | null; readonly codexAuthPath: string }) =>
  apiPost("/auth/codex/login", req, AuthStatusResponseSchema)

export const apiAuthCodexStatus = (req: { readonly label?: string | null; readonly codexAuthPath: string }) =>
  apiPost("/auth/codex/status", req, AuthStatusResponseSchema)

export const apiAuthCodexLogout = (req: { readonly label?: string | null; readonly codexAuthPath: string }) =>
  apiPost("/auth/codex/logout", req, AuthStatusResponseSchema)

export const apiAuthClaudeLogin = (req: { readonly label?: string | null; readonly claudeAuthPath: string }) =>
  apiPost("/auth/claude/login", req, AuthStatusResponseSchema)

export const apiAuthClaudeStatus = (req: { readonly label?: string | null; readonly claudeAuthPath: string }) =>
  apiPost("/auth/claude/status", req, AuthStatusResponseSchema)

export const apiAuthClaudeLogout = (req: { readonly label?: string | null; readonly claudeAuthPath: string }) =>
  apiPost("/auth/claude/logout", req, AuthStatusResponseSchema)

// ─── State endpoints ─────────────────────────────────────────────────────────

export const apiStatePath = () => apiGet("/state/path", StatePathResponseSchema)

export const apiStateInit = (req: { readonly repoUrl: string; readonly repoRef?: string }) =>
  apiPost("/state/init", req, StateOutputResponseSchema)

export const apiStateStatus = () => apiGet("/state/status", StateOutputResponseSchema)

export const apiStatePull = () => apiPost("/state/pull", {}, StateOutputResponseSchema)

export const apiStatePush = () => apiPost("/state/push", {}, StateOutputResponseSchema)

export const apiStateCommit = (req: { readonly message: string }) =>
  apiPost("/state/commit", req, StateOutputResponseSchema)

export const apiStateSync = (req: { readonly message?: string | null }) =>
  apiPost("/state/sync", req, StateOutputResponseSchema)

// ─── Scrap endpoints ──────────────────────────────────────────────────────────

export const apiScrapExport = (req: { readonly projectDir: string; readonly archivePath?: string }) =>
  apiPost("/scrap/export", req, SessionsOutputSchema)

export const apiScrapImport = (req: {
  readonly projectDir: string
  readonly archivePath: string
  readonly wipe?: boolean
}) => apiPost("/scrap/import", req, SessionsOutputSchema)

// ─── MCP Playwright ───────────────────────────────────────────────────────────

export const apiMcpPlaywrightUp = (req: { readonly projectDir: string; readonly runUp?: boolean }) =>
  apiPost("/mcp-playwright", req, SessionsOutputSchema)

// ─── Sessions endpoints ───────────────────────────────────────────────────────

export const apiSessionsList = (req: { readonly projectDir: string; readonly includeDefault?: boolean }) =>
  apiPost("/sessions/list", req, SessionsOutputSchema)

export const apiSessionsKill = (req: { readonly projectDir: string; readonly pid: number }) =>
  apiPost("/sessions/kill", req, SessionsOutputSchema)

export const apiSessionsLogs = (req: { readonly projectDir: string; readonly pid: number; readonly lines?: number }) =>
  apiPost("/sessions/logs", req, SessionsOutputSchema)

// ─── Project create request ───────────────────────────────────────────────────

export type ProjectCreateRequest = {
  readonly repoUrl?: string | undefined
  readonly repoRef?: string | undefined
  readonly targetDir?: string | undefined
  readonly sshPort?: string | undefined
  readonly sshUser?: string | undefined
  readonly containerName?: string | undefined
  readonly serviceName?: string | undefined
  readonly volumeName?: string | undefined
  readonly authorizedKeysPath?: string | undefined
  readonly envGlobalPath?: string | undefined
  readonly envProjectPath?: string | undefined
  readonly codexAuthPath?: string | undefined
  readonly codexHome?: string | undefined
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly dockerNetworkMode?: string | undefined
  readonly dockerSharedNetworkName?: string | undefined
  readonly enableMcpPlaywright?: boolean | undefined
  readonly outDir?: string | undefined
  readonly gitTokenLabel?: string | undefined
  readonly codexTokenLabel?: string | undefined
  readonly claudeTokenLabel?: string | undefined
  readonly agentAutoMode?: string | undefined
  readonly up?: boolean | undefined
  readonly openSsh?: boolean | undefined
  readonly force?: boolean | undefined
  readonly forceEnv?: boolean | undefined
}

// ─── Project apply request ────────────────────────────────────────────────────

export type ProjectApplyRequest = {
  readonly runUp?: boolean | undefined
  readonly gitTokenLabel?: string | undefined
  readonly codexTokenLabel?: string | undefined
  readonly claudeTokenLabel?: string | undefined
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly enableMcpPlaywright?: boolean | undefined
}

// ─── Projects endpoints ───────────────────────────────────────────────────────

export const apiProjectsList = () => apiGet("/projects", ProjectsListResponseSchema)

export const apiProjectGet = (projectId: string) =>
  apiGet(`/projects/${encodeURIComponent(projectId)}`, Schema.Struct({ project: ProjectDetailsSchema }))

export const apiProjectCreate = (req: ProjectCreateRequest) => apiPost("/projects", req, ProjectCreatedResponseSchema)

export const apiProjectsDownAll = () => apiPost("/projects/down-all", {}, OkResponseSchema)

export const apiProjectApply = (projectId: string, req: ProjectApplyRequest) =>
  apiPost(`/projects/${encodeURIComponent(projectId)}/apply`, req, ApplyResultSchema)
