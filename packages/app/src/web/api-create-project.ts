import type { Effect } from "effect"

import { requestJson } from "./api-http.js"
import { CreateProjectAcceptedResponseSchema } from "./api-schema.js"
import type { CreateProjectAcceptedResponse, CreateProjectDraft } from "./api-schema.js"

export const startCreateProject = (draft: CreateProjectDraft): Effect.Effect<CreateProjectAcceptedResponse, string> =>
  requestJson(
    "POST",
    "/projects",
    CreateProjectAcceptedResponseSchema,
    { ...draft, async: true, openSsh: false, useManagedAuthorizedKeys: true }
  )
