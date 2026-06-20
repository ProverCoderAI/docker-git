import type {
  AuthSnapshot,
  PanelCloudflareTunnelSession,
  ProjectAuthSnapshot,
  ProjectDetails,
  ProjectSummary,
  TerminalSession
} from "./api-schema.js"

type OptionalProjectSummaryFields = {
  readonly clonedOnHostname?: string | undefined
  readonly containerName?: string | undefined
}

type ProjectSummaryTransport =
  & Omit<ProjectSummary, keyof OptionalProjectSummaryFields>
  & OptionalProjectSummaryFields

type ProjectDetailsTransport =
  & Omit<ProjectDetails, "clonedOnHostname">
  & {
    readonly clonedOnHostname?: string | undefined
  }

type OptionalAuthProviderSnapshotFields = {
  readonly codexAuthEntries?: number | undefined
  readonly codexAuthPath?: string | undefined
  readonly grokAuthEntries?: number | undefined
  readonly grokAuthPath?: string | undefined
}

type AuthSnapshotTransport =
  & Omit<AuthSnapshot, keyof OptionalAuthProviderSnapshotFields>
  & OptionalAuthProviderSnapshotFields

type ProjectAuthSnapshotTransport =
  & Omit<ProjectAuthSnapshot, keyof OptionalAuthProviderSnapshotFields>
  & OptionalAuthProviderSnapshotFields

type OptionalTerminalSessionFields = {
  readonly attachedClients?: number | undefined
  readonly closedAt?: string | undefined
  readonly exitCode?: number | undefined
  readonly signal?: number | undefined
  readonly startedAt?: string | undefined
}

type TerminalSessionTransport =
  & Omit<TerminalSession, keyof OptionalTerminalSessionFields>
  & OptionalTerminalSessionFields

type PanelCloudflareTunnelSessionTransport =
  & Omit<PanelCloudflareTunnelSession, "logTail">
  & {
    readonly logTail: ReadonlyArray<string>
  }

const normalizeAuthProviderSnapshotFields = <Snapshot extends OptionalAuthProviderSnapshotFields>(
  snapshot: Snapshot
) => ({
  ...snapshot,
  codexAuthEntries: snapshot.codexAuthEntries ?? 0,
  codexAuthPath: snapshot.codexAuthPath ?? "",
  grokAuthEntries: snapshot.grokAuthEntries ?? 0,
  grokAuthPath: snapshot.grokAuthPath ?? ""
})

/**
 * Normalizes generated transport project summaries before exposing UI state.
 *
 * @param project - OpenAPI project summary transport shape.
 * @returns UI project summary with exact optional fields.
 *
 * @pure true - deterministic object projection.
 * @effect none.
 * @invariant undefined optional fields are omitted and required project fields are preserved.
 * @precondition project came from the typed OpenAPI client.
 * @postcondition result satisfies ProjectSummary exact-optional semantics.
 * @complexity O(1)/O(1).
 * @throws Never.
 */
// CHANGE: Normalize generated transport project summaries before exposing UI state.
// WHY: OpenAPI optional fields are `T | undefined`; UI Schema types use exact optional properties.
// QUOTE(ТЗ): "client сам возвращает нужную схему рабочую"
// REF: user-openapi-effect-direct-client
// SOURCE: n/a
// FORMAT THEOREM: forall p: undefined optional fields are omitted in normalizeProjectSummary(p).
// PURITY: CORE
// EFFECT: none
// INVARIANT: required project fields are preserved exactly.
// COMPLEXITY: O(1)/O(1)
export const normalizeProjectSummary = (project: ProjectSummaryTransport): ProjectSummary => {
  const { clonedOnHostname, containerName, ...required } = project
  return {
    ...required,
    ...(clonedOnHostname !== undefined && { clonedOnHostname }),
    ...(containerName !== undefined && { containerName })
  }
}

/**
 * Normalizes generated project details before exposing UI state.
 *
 * @param project - OpenAPI project details transport shape.
 * @returns UI project details with exact optional fields.
 *
 * @pure true.
 * @effect none.
 * @invariant clonedOnHostname is omitted when absent; all required details are preserved.
 * @precondition project came from a typed project details endpoint.
 * @postcondition result satisfies ProjectDetails exact-optional semantics.
 * @complexity O(1)/O(1).
 * @throws Never.
 */
export const normalizeProjectDetails = (project: ProjectDetailsTransport): ProjectDetails => {
  const { clonedOnHostname, ...required } = project
  return clonedOnHostname === undefined ? required : { ...required, clonedOnHostname }
}

/**
 * Normalizes auth snapshot provider defaults.
 *
 * @param snapshot - OpenAPI global auth snapshot.
 * @returns UI auth snapshot with codex/grok defaults filled.
 *
 * @pure true.
 * @effect none.
 * @invariant missing codex/grok counts become 0 and missing paths become empty strings.
 * @precondition snapshot came from the auth menu endpoint.
 * @postcondition result satisfies AuthSnapshot required-field semantics.
 * @complexity O(1)/O(1).
 * @throws Never.
 */
export const normalizeAuthSnapshot = (snapshot: AuthSnapshotTransport): AuthSnapshot =>
  normalizeAuthProviderSnapshotFields(snapshot)

/**
 * Normalizes project auth snapshot provider defaults.
 *
 * @param snapshot - OpenAPI project auth snapshot.
 * @returns UI project auth snapshot with codex/grok defaults filled.
 *
 * @pure true.
 * @effect none.
 * @invariant missing codex/grok counts become 0 and missing paths become empty strings.
 * @precondition snapshot came from the project auth menu endpoint.
 * @postcondition result satisfies ProjectAuthSnapshot required-field semantics.
 * @complexity O(1)/O(1).
 * @throws Never.
 */
export const normalizeProjectAuthSnapshot = (snapshot: ProjectAuthSnapshotTransport): ProjectAuthSnapshot =>
  normalizeAuthProviderSnapshotFields(snapshot)

/**
 * Normalizes terminal session optional fields.
 *
 * @param session - OpenAPI terminal session transport shape.
 * @returns UI terminal session with exact optional fields.
 *
 * @pure true.
 * @effect none.
 * @invariant undefined optional terminal fields are omitted from the result.
 * @precondition session came from a typed terminal endpoint.
 * @postcondition result satisfies TerminalSession exact-optional semantics.
 * @complexity O(1)/O(1).
 * @throws Never.
 */
export const normalizeTerminalSession = (session: TerminalSessionTransport): TerminalSession => {
  const { attachedClients, closedAt, exitCode, signal, startedAt, ...required } = session
  return {
    ...required,
    ...(attachedClients !== undefined && { attachedClients }),
    ...(closedAt !== undefined && { closedAt }),
    ...(exitCode !== undefined && { exitCode }),
    ...(signal !== undefined && { signal }),
    ...(startedAt !== undefined && { startedAt })
  }
}

/**
 * Normalizes panel Cloudflare tunnel session array mutability.
 *
 * @param session - OpenAPI panel tunnel session transport shape.
 * @returns UI panel tunnel session with a local logTail array copy.
 *
 * @pure true.
 * @effect none.
 * @invariant scalar tunnel fields are preserved and logTail values keep order.
 * @precondition session came from a typed panel tunnel endpoint.
 * @postcondition result satisfies PanelCloudflareTunnelSession array semantics.
 * @complexity O(n)/O(n), where n is logTail length.
 * @throws Never.
 */
export const normalizePanelCloudflareTunnelSession = (
  session: PanelCloudflareTunnelSessionTransport
): PanelCloudflareTunnelSession => ({
  ...session,
  logTail: [...session.logTail]
})

/**
 * Normalizes nullable panel Cloudflare tunnel sessions.
 *
 * @param session - OpenAPI panel tunnel session or null.
 * @returns null unchanged or a normalized UI panel tunnel session.
 *
 * @pure true.
 * @effect none.
 * @invariant null remains null; non-null sessions are normalized by normalizePanelCloudflareTunnelSession.
 * @precondition value came from a typed panel tunnel endpoint.
 * @postcondition result is safe for UI panel tunnel state.
 * @complexity O(n)/O(n), where n is logTail length for non-null sessions.
 * @throws Never.
 */
export const normalizeNullablePanelCloudflareTunnelSession = (
  session: PanelCloudflareTunnelSessionTransport | null
): PanelCloudflareTunnelSession | null => session === null ? null : normalizePanelCloudflareTunnelSession(session)
