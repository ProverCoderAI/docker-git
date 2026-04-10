import { Effect } from "effect"

import { createProjectTerminalSession } from "./api-client.js"
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
      readonly session: {
        readonly id: string
        readonly projectId: string
        readonly sshCommand: string
        readonly status: "ready" | "attached" | "exited" | "failed"
        readonly createdAt: string
        readonly startedAt?: string | undefined
        readonly closedAt?: string | undefined
        readonly exitCode?: number | undefined
        readonly signal?: number | undefined
      }
    } | null,
    HostError,
    ControllerRuntime
  >
  readonly attach: (
    project: ProjectItem,
    session: {
      readonly id: string
      readonly projectId: string
      readonly sshCommand: string
      readonly status: "ready" | "attached" | "exited" | "failed"
      readonly createdAt: string
      readonly startedAt?: string | undefined
      readonly closedAt?: string | undefined
      readonly exitCode?: number | undefined
      readonly signal?: number | undefined
    }
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
