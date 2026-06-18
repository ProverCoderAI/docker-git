import type { Effect } from "effect"

import {
  baseCreateProjectBody,
  type CreateProjectRequestDraft,
  optionalProjectResourceFields
} from "./api-project-create-body.js"
import { CreateProjectAcceptedResponseSchema } from "./api-schema.js"
import type { CreateProjectAcceptedResponse } from "./api-schema.js"
import { openApiJsonSchema } from "./openapi-client.js"

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
export const createProjectAcceptedBody = (draft: CreateProjectRequestDraft) => ({
  ...baseCreateProjectBody(draft),
  async: true,
  ...optionalProjectResourceFields(draft)
})

export const startCreateProject = (
  draft: CreateProjectRequestDraft
): Effect.Effect<CreateProjectAcceptedResponse, string> =>
  openApiJsonSchema(CreateProjectAcceptedResponseSchema, (client) =>
    client.POST("/projects", {
      body: createProjectAcceptedBody(draft)
    }))
