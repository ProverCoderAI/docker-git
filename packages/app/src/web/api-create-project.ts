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
