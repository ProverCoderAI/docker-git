import { Effect } from "effect"

import { createProjectTerminalSession } from "./api-client.js"
import type { ApiProjectDetails } from "./api-project-codec.js"
import { projectItemFromApiDetails } from "./project-item.js"
import { attachTerminalSession } from "./terminal-session-client.js"

type AutoOpenSshCommand = {
  readonly openSsh: boolean
  readonly runUp: boolean
}

type RenderableError = Error | { readonly message: string }

const renderKnownError = (error: RenderableError): string => error.message

const shouldOpenSsh = (command: AutoOpenSshCommand): boolean => command.openSsh

const isInteractiveTty = (): boolean => process.stdin.isTTY && process.stdout.isTTY

const shouldAutoOpenSsh = ({
  runUp,
  shouldOpen
}: {
  readonly shouldOpen: boolean
  readonly runUp: boolean
}): Effect.Effect<boolean> =>
  Effect.gen(function*(_) {
    if (!shouldOpen) {
      return false
    }
    if (!runUp) {
      yield* _(Effect.logWarning("Skipping SSH auto-open: docker compose up disabled (--no-up)."))
      return false
    }
    if (!isInteractiveTty()) {
      yield* _(Effect.logWarning("Skipping SSH auto-open: not running in an interactive TTY."))
      return false
    }
    return true
  })

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

    const item = projectItemFromApiDetails(project)
    const terminal = yield* _(createProjectTerminalSession(item.projectDir))
    if (terminal === null) {
      yield* _(Effect.logWarning(`Skipping SSH auto-open: terminal session was not created for ${item.displayName}.`))
      return
    }
    yield* _(
      attachTerminalSession({
        header: `SSH terminal: ${item.displayName}`,
        session: terminal.session,
        websocketPath: `/projects/${encodeURIComponent(item.projectDir)}/terminal-sessions/${
          encodeURIComponent(terminal.session.id)
        }/ws`
      })
    )
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.logWarning(`SSH auto-open failed: ${renderKnownError(error)}`),
      onSuccess: () => Effect.void
    })
  )
