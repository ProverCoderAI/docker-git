import type { Effect } from "effect"

import { CreateProjectAcceptedResponseSchema } from "./api-schema.js"
import type { CreateProjectAcceptedResponse, CreateProjectDraft } from "./api-schema.js"
import { openApiJsonSchema } from "./openapi-client.js"

const createProjectAcceptedBody = (draft: CreateProjectDraft) => ({
  async: true,
  cpuLimit: draft.cpuLimit,
  enableMcpPlaywright: draft.enableMcpPlaywright,
  force: draft.force,
  forceEnv: draft.forceEnv,
  gpu: draft.gpu,
  openSsh: false,
  outDir: draft.outDir,
  ramLimit: draft.ramLimit,
  repoRef: draft.repoRef,
  repoUrl: draft.repoUrl,
  up: draft.up,
  useManagedAuthorizedKeys: true
})

export const startCreateProject = (draft: CreateProjectDraft): Effect.Effect<CreateProjectAcceptedResponse, string> =>
  openApiJsonSchema(CreateProjectAcceptedResponseSchema, (client) => client.POST("/projects", {
    body: createProjectAcceptedBody(draft)
  }))
