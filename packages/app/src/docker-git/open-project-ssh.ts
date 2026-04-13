import { Effect } from "effect"

import { createProjectTerminalSession } from "./api-client.js"
import type { ApiTerminalSession } from "./api-terminal-codec.js"
import type { ControllerRuntime } from "./controller.js"
import type { HostError } from "./host-errors.js"
import type { ProjectItem } from "./project-item.js"
import { attachTerminalSession } from "./terminal-session-client.js"

export type OpenResolvedProjectSshDeps = {
  readonly createSession: (
    projectId: string
  ) => Effect.Effect<
    {
      readonly project: Readonly<Record<string, string | number | boolean | null | undefined>>
      readonly session: ApiTerminalSession
    } | null,
    HostError,
    ControllerRuntime
  >
  readonly attach: (
    project: ProjectItem,
    session: ApiTerminalSession
  ) => Effect.Effect<void, HostError>
}

const missingTerminalSessionError = (item: ProjectItem): HostError => ({
  _tag: "TerminalSessionClientError",
  message: `Terminal session was not created for ${item.displayName}.`
})

export const openResolvedProjectSshEffect = (
  item: ProjectItem,
  deps: OpenResolvedProjectSshDeps
) =>
  Effect.gen(function*(_) {
    const prepared = yield* _(deps.createSession(item.projectDir))
    if (prepared === null) {
      return yield* _(Effect.fail(missingTerminalSessionError(item)))
    }

    yield* _(deps.attach(item, prepared.session))
  })

export const openResolvedProjectSsh = (item: ProjectItem) =>
  openResolvedProjectSshEffect(item, {
    createSession: (projectId) => createProjectTerminalSession(projectId),
    attach: (project, session) =>
      attachTerminalSession({
        header: `SSH terminal: ${project.displayName}`,
        session,
        websocketPath: `/projects/${encodeURIComponent(project.projectDir)}/terminal-sessions/${
          encodeURIComponent(session.id)
        }/ws`
      })
  })
