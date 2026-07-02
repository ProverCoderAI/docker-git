import { Effect, Match } from "effect"

import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"
import {
  type BaseCreateProjectBody,
  baseCreateProjectBody,
  type CreateProjectRequestDraft,
  optionalProjectResourceFields,
  type OptionalProjectResourceFieldsBody
} from "./api-project-create-body.js"
import type { CreateProjectAcceptedResponse } from "./api-schema.js"

type CreateProjectAcceptedBody = Readonly<
  & BaseCreateProjectBody
  & OptionalProjectResourceFieldsBody
  & {
    readonly async: true
  }
>

/**
 * Builds the async POST /projects request body.
 *
 * @param draft - Validated project creation draft plus optional resource limits.
 * @returns Request body for an accepted asynchronous create request.
 *
 * @pure true - deterministic serialization of immutable input.
 * @effect none
 * @invariant async create uses the same common fields and optional resource fields as sync create.
 * @precondition draft fields were validated by the UI create flow.
 * @postcondition output includes async = true and preserves defined Playwright resource limits.
 * @complexity O(1).
 * @throws Never.
 */
export const createProjectAcceptedBody = (draft: CreateProjectRequestDraft): CreateProjectAcceptedBody => ({
  ...baseCreateProjectBody(draft),
  async: true,
  ...optionalProjectResourceFields(draft)
})

// CHANGE: Publish the async project creation boundary with an explicit Effect signature.
// WHY: exported web API helpers must expose typed success, error, and requirement channels.
// QUOTE(ТЗ): "исправь"
// REF: PR#431 CodeRabbit review 4535473023
// SOURCE: n/a
// FORMAT THEOREM: forall draft d: accepted(d) -> Effect<CreateProjectAcceptedResponse, string, never>.
// PURITY: SHELL
// EFFECT: Effect<CreateProjectAcceptedResponse, string, never>
// INVARIANT: only HTTP 202 is accepted as the asynchronous creation success branch.
// COMPLEXITY: O(1)/O(1), excluding HTTP transport.
/**
 * Starts asynchronous project creation through the typed OpenAPI client.
 *
 * @param draft - Validated project creation draft plus optional resource limits.
 * @returns Effect that resolves to the accepted async creation response.
 *
 * @pure false - performs HTTP IO when the returned Effect is executed.
 * @effect Effect<CreateProjectAcceptedResponse, string, never>
 * @invariant HTTP 202 returns the accepted response; HTTP 201 is rejected as a sync branch mismatch.
 * @precondition draft fields were validated by the UI create flow.
 * @postcondition downstream callers observe only accepted async responses or string-rendered failures.
 * @complexity O(1)/O(1), excluding HTTP transport and response body size.
 * @throws Never - failures are represented in the Effect error channel.
 */
export const startCreateProject = (
  draft: CreateProjectRequestDraft
): Effect.Effect<CreateProjectAcceptedResponse, string> =>
  dockerGitOpenApi.POST("/projects", {
    body: createProjectAcceptedBody(draft)
  }).pipe(
    Effect.mapError(renderDockerGitOpenApiFailure),
    Effect.flatMap((success) =>
      Match.value(success).pipe(
        Match.when({ status: 202 }, ({ body }) => Effect.succeed(body)),
        Match.when({ status: 201 }, () => Effect.fail("HTTP 201: unexpected synchronous project creation response")),
        Match.exhaustive
      )
    )
  )
