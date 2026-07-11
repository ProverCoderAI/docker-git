import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect } from "effect"

import { activeAgents } from "./container-tasks-core.js"
import { readContainerTaskSnapshot } from "./container-tasks.js"
import { hasLiveProjectBrowserSession } from "./project-browser.js"
import { hasLiveProjectSkillerSession } from "./skiller.js"
import { hasLiveProjectTerminalSession } from "./terminal-sessions.js"

// CHANGE: share project activity predicates across auto-suspend and auto-delete loops
// WHY: both loops must agree on what "work in progress" means; avoid duplicate logic
// REF: issue-117
// PURITY: SHELL
// INVARIANT: failures resolve to "no active agent" so callers stay conservative

/**
 * Whether an agent is currently working inside the project's container.
 *
 * @pure false
 * @effect FileSystem (task snapshot)
 * @invariant snapshot read failures resolve to `false`
 * @complexity O(tasks)
 */
export const projectHasActiveAgent = (
  project: ProjectItem
) =>
  readContainerTaskSnapshot(project.projectDir, false).pipe(
    Effect.map((snapshot) =>
      activeAgents(snapshot.agents).length > 0 || snapshot.tasks.some((task) => task.kind === "agent")
    ),
    Effect.catchAll(() => Effect.succeed(false))
  )

/**
 * Whether a live interactive session (ssh/terminal/browser/skiller) is attached.
 *
 * @pure false (reads in-memory session registries)
 * @complexity O(1)
 */
export const projectHasLiveInteractiveSession = (
  project: ProjectItem,
  sshSessions: number
): boolean =>
  sshSessions > 0 ||
  hasLiveProjectTerminalSession(project.projectDir) ||
  hasLiveProjectBrowserSession(project.projectDir) ||
  hasLiveProjectSkillerSession(project.projectDir)
