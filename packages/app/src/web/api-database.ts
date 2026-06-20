import { Effect } from "effect"

import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"
import type { ProjectDatabaseForward, ProjectDatabaseProfile, ProjectDatabaseSession } from "./api-schema.js"

// CHANGE: Document the pure database editor URL projection.
// WHY: exported DB helpers should state their CORE/SHELL boundary and invariant explicitly.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall session s: projectDatabaseEditorUrl(s) = s.editorPath.
// PURITY: CORE
// EFFECT: none
// INVARIANT: result is a direct projection of the decoded session.
// COMPLEXITY: O(1)/O(1).
/**
 * Reads the in-app editor URL from a database session.
 *
 * @param session - Database editor session returned by the API.
 * @returns Editor path for browser navigation.
 *
 * @pure true - deterministic projection from immutable input.
 * @effect none
 * @invariant result = session.editorPath.
 * @precondition session was decoded from the API schema.
 * @postcondition no network or DOM side effects are performed.
 * @complexity O(1)/O(1).
 * @throws Never.
 */
export const projectDatabaseEditorUrl = (session: ProjectDatabaseSession): string => session.editorPath

// CHANGE: Document the pure database external address formatter.
// WHY: exported DB helpers should state their CORE/SHELL boundary and invariant explicitly.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall forward f: projectDatabaseExternalUrl(f) = f.publicHost + ":" + f.hostPort.
// PURITY: CORE
// EFFECT: none
// INVARIANT: result is derived only from publicHost and hostPort.
// COMPLEXITY: O(1)/O(1).
/**
 * Formats the external database forward address.
 *
 * @param forward - Database forward returned by the API.
 * @returns Host and port pair for external clients.
 *
 * @pure true - deterministic projection from immutable input.
 * @effect none
 * @invariant result = `${publicHost}:${hostPort}`.
 * @precondition forward was decoded from the API schema.
 * @postcondition no network or DOM side effects are performed.
 * @complexity O(1)/O(1).
 * @throws Never.
 */
export const projectDatabaseExternalUrl = (forward: ProjectDatabaseForward): string =>
  `${forward.publicHost}:${forward.hostPort}`

// CHANGE: Publish database profile loading with an explicit Effect boundary type.
// WHY: exported OpenAPI helpers must expose success, error, and requirement channels without inference drift.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall projectId p: loadProfiles(p) -> Effect<ReadonlyArray<ProjectDatabaseProfile>, string, never>.
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<ProjectDatabaseProfile>, string, never>
// INVARIANT: response body snapshot is reduced to its immutable profiles collection.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Loads database connection profiles for a project.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @returns Effect with the immutable profile collection.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<ReadonlyArray<ProjectDatabaseProfile>, string, never>
 * @invariant successful responses expose exactly body.profiles to callers.
 * @precondition projectId names an existing project for successful responses.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const loadProjectDatabaseProfiles = (
  projectId: string
): Effect.Effect<ReadonlyArray<ProjectDatabaseProfile>, string> =>
  dockerGitOpenApi.GET("/projects/{projectId}/databases/profiles", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.profiles),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// CHANGE: Publish database forward loading with an explicit Effect boundary type.
// WHY: callers should depend on the API contract, not inferred generated-client internals.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall projectId p: loadForwards(p) -> Effect<ReadonlyArray<ProjectDatabaseForward>, string, never>.
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<ProjectDatabaseForward>, string, never>
// INVARIANT: successful responses expose exactly body.forwards.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Loads active database forwards for a project.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @returns Effect with the immutable forward collection.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<ReadonlyArray<ProjectDatabaseForward>, string, never>
 * @invariant successful responses expose exactly body.forwards to callers.
 * @precondition projectId names an existing project for successful responses.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const loadProjectDatabaseForwards = (
  projectId: string
): Effect.Effect<ReadonlyArray<ProjectDatabaseForward>, string> =>
  dockerGitOpenApi.GET("/projects/{projectId}/databases/forwards", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.forwards),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// CHANGE: Publish profile persistence with an explicit Effect boundary type.
// WHY: callers should receive the saved profile DTO and a typed string failure channel.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall input i: saveProfile(i) -> Effect<ProjectDatabaseProfile, string, never>.
// PURITY: SHELL
// EFFECT: Effect<ProjectDatabaseProfile, string, never>
// INVARIANT: successful responses expose exactly body.profile.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Saves a database connection profile for a project.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @param connectionString - Database connection string to persist.
 * @param label - Optional user-facing profile label.
 * @returns Effect with the saved database profile.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<ProjectDatabaseProfile, string, never>
 * @invariant successful responses expose exactly body.profile to callers.
 * @precondition connectionString is accepted by the API validator for successful responses.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const saveProjectDatabaseProfile = (
  projectId: string,
  connectionString: string,
  label: string | null
): Effect.Effect<ProjectDatabaseProfile, string> =>
  dockerGitOpenApi.POST("/projects/{projectId}/databases/profiles", {
    body: { connectionString, label },
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.profile),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// CHANGE: Publish profile deletion as an explicit void Effect.
// WHY: DELETE success body is not consumed by the UI and should not leak generated response details.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall ids: deleteProfile(ids) -> Effect<void, string, never>.
// PURITY: SHELL
// EFFECT: Effect<void, string, never>
// INVARIANT: successful HTTP deletion maps to void.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Deletes a database profile from a project.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @param profileId - Database profile identifier accepted by the API route.
 * @returns Effect that completes with void on deletion success.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<void, string, never>
 * @invariant successful deletion has no UI-facing payload.
 * @precondition projectId and profileId identify an existing profile for successful responses.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const deleteProjectDatabaseProfile = (
  projectId: string,
  profileId: string
): Effect.Effect<void, string> =>
  dockerGitOpenApi.DELETE("/projects/{projectId}/databases/profiles/{profileId}", {
    params: { path: { profileId, projectId } }
  }).pipe(
    Effect.asVoid,
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// CHANGE: Publish profile exposure with an explicit forward Effect.
// WHY: the shell boundary should expose the normalized domain DTO rather than inferred response wrappers.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall ids: exposeProfile(ids) -> Effect<ProjectDatabaseForward, string, never>.
// PURITY: SHELL
// EFFECT: Effect<ProjectDatabaseForward, string, never>
// INVARIANT: successful responses expose exactly body.forward.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Exposes a database profile through a public forward.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @param profileId - Database profile identifier accepted by the API route.
 * @returns Effect with the created or existing forward.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<ProjectDatabaseForward, string, never>
 * @invariant successful responses expose exactly body.forward to callers.
 * @precondition projectId and profileId identify an exposable database profile.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const exposeProjectDatabaseProfile = (
  projectId: string,
  profileId: string
): Effect.Effect<ProjectDatabaseForward, string> =>
  dockerGitOpenApi.POST("/projects/{projectId}/databases/profiles/{profileId}/expose", {
    params: { path: { profileId, projectId } }
  }).pipe(
    Effect.map(({ body }) => body.forward),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// CHANGE: Publish forward deletion as an explicit void Effect.
// WHY: DELETE success is operational, while callers only need completion or a rendered failure.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall ids: deleteForward(ids) -> Effect<void, string, never>.
// PURITY: SHELL
// EFFECT: Effect<void, string, never>
// INVARIANT: successful HTTP deletion maps to void.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Deletes the public forward for a database profile.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @param profileId - Database profile identifier accepted by the API route.
 * @returns Effect that completes with void on deletion success.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<void, string, never>
 * @invariant successful deletion has no UI-facing payload.
 * @precondition projectId and profileId identify an existing forward for successful responses.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const deleteProjectDatabaseForward = (
  projectId: string,
  profileId: string
): Effect.Effect<void, string> =>
  dockerGitOpenApi.DELETE("/projects/{projectId}/databases/profiles/{profileId}/expose", {
    params: { path: { profileId, projectId } }
  }).pipe(
    Effect.asVoid,
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// CHANGE: Publish database session loading with an explicit Effect boundary type.
// WHY: editor consumers should receive the session DTO directly and a typed string error channel.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall projectId p: loadSession(p) -> Effect<ProjectDatabaseSession, string, never>.
// PURITY: SHELL
// EFFECT: Effect<ProjectDatabaseSession, string, never>
// INVARIANT: successful responses expose exactly body.session.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Loads the current database editor session for a project.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @returns Effect with the database editor session.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<ProjectDatabaseSession, string, never>
 * @invariant successful responses expose exactly body.session to callers.
 * @precondition projectId names an existing project for successful responses.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const loadProjectDatabaseSession = (
  projectId: string
): Effect.Effect<ProjectDatabaseSession, string> =>
  dockerGitOpenApi.GET("/projects/{projectId}/databases/session", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.session),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// CHANGE: Publish database editor startup with an explicit Effect boundary type.
// WHY: callers should observe the session DTO, not generated response shape details.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall projectId p: openEditor(p) -> Effect<ProjectDatabaseSession, string, never>.
// PURITY: SHELL
// EFFECT: Effect<ProjectDatabaseSession, string, never>
// INVARIANT: successful responses expose exactly body.session.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Opens the database editor session for a project.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @returns Effect with the opened database editor session.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<ProjectDatabaseSession, string, never>
 * @invariant successful responses expose exactly body.session to callers.
 * @precondition projectId names an existing project for successful responses.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const openProjectDatabaseEditor = (
  projectId: string
): Effect.Effect<ProjectDatabaseSession, string> =>
  dockerGitOpenApi.POST("/projects/{projectId}/databases/open", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.session),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// CHANGE: Publish database editor restart with an explicit Effect boundary type.
// WHY: restart is a shell operation whose observable result is the refreshed session DTO.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall projectId p: restartEditor(p) -> Effect<ProjectDatabaseSession, string, never>.
// PURITY: SHELL
// EFFECT: Effect<ProjectDatabaseSession, string, never>
// INVARIANT: successful responses expose exactly body.session.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Restarts the database editor session for a project.
 *
 * @param projectId - Project identifier accepted by the API route.
 * @returns Effect with the restarted database editor session.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<ProjectDatabaseSession, string, never>
 * @invariant successful responses expose exactly body.session to callers.
 * @precondition projectId names an existing project for successful responses.
 * @postcondition transport failures are rendered into the string error channel.
 * @complexity O(1)/O(1), excluding HTTP transport and response size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const restartProjectDatabaseEditor = (
  projectId: string
): Effect.Effect<ProjectDatabaseSession, string> =>
  dockerGitOpenApi.POST("/projects/{projectId}/databases/restart", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.session),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )
