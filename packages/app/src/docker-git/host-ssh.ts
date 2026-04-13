import { Effect } from "effect"

import { shouldAutoOpenSsh } from "../shared/auto-open-ssh.js"
import { getProject } from "./api-client.js"
import type { ApiProjectDetails } from "./api-project-codec.js"
import { openResolvedProjectSsh } from "./open-project-ssh.js"
import { projectItemFromApiDetails } from "./project-item.js"

type AutoOpenSshCommand = {
  readonly openSsh: boolean
  readonly runUp: boolean
}

type RenderableError = Error | { readonly message: string }

const renderKnownError = (error: RenderableError): string => error.message

const shouldOpenSsh = (command: AutoOpenSshCommand): boolean => command.openSsh

export const autoOpenProjectSsh = (
  command: AutoOpenSshCommand,
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

    const refreshedProject = yield* _(
      getProject(project.id).pipe(Effect.orElseSucceed(() => null))
    )
    const item = projectItemFromApiDetails(refreshedProject ?? project)
    yield* _(openResolvedProjectSsh(item))
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.logWarning(`SSH auto-open failed: ${renderKnownError(error)}`),
      onSuccess: () => Effect.void
    })
  )
