import { Effect } from "effect"

import type { CreateCommand } from "@lib/core/domain"
import { shouldAutoOpenSsh } from "@lib/usecases/auto-open-ssh"
import { connectProjectSsh, waitForProjectSshReady } from "@lib/usecases/projects"

import type { ApiProjectDetails } from "./api-project-codec.js"
import { resolveHostSshMaterial } from "./host-ssh-material.js"
import { resolveApiProjectItemWithSshKeyPath } from "./project-item.js"

type RenderableError = Error | { readonly message: string }

const renderKnownError = (error: RenderableError): string => error.message

const shouldOpenSsh = (command: CreateCommand): boolean => command.openSsh

const resolveProjectItem = (
  command: CreateCommand,
  project: ApiProjectDetails
) =>
  Effect.gen(function*(_) {
    const sshMaterial = yield* _(resolveHostSshMaterial(command))
    return yield* _(resolveApiProjectItemWithSshKeyPath(project, sshMaterial.privateKeyPath))
  })

export const autoOpenProjectSsh = (
  command: CreateCommand,
  project: ApiProjectDetails | null
) =>
  Effect.gen(function*(_) {
    const autoOpenSsh = yield* _(
      shouldAutoOpenSsh({
        shouldOpen: shouldOpenSsh(command),
        runUp: command.runUp
      })
    )
    if (!autoOpenSsh) {
      return
    }

    if (project === null) {
      yield* _(Effect.logWarning("Skipping SSH auto-open: API did not return project details."))
      return
    }

    const item = yield* _(resolveProjectItem(command, project))
    yield* _(Effect.log(`Opening SSH: ${item.sshCommand}`))
    yield* _(waitForProjectSshReady(item))
    yield* _(connectProjectSsh(item))
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.logWarning(`SSH auto-open failed: ${renderKnownError(error)}`),
      onSuccess: () => Effect.void
    })
  )
