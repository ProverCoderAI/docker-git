import { Effect } from "effect"
import { type Dispatch, type SetStateAction, useCallback, useState } from "react"

import {
  applyProject,
  type ContainerTaskSnapshot,
  createProjectTerminalSession,
  loadProjectBrowser,
  loadProjectTaskLogs,
  loadProjectTasks,
  projectBrowserCdpUrl,
  projectBrowserNoVncUrl,
  type ProjectBrowserSession,
  stopProjectTask
} from "./api.js"
import { openUrl } from "./open-url.js"
import { projectSshRoutePath } from "./terminal.js"

export type StateMessageUpdater = (message: string | null) => void

export type ProjectHandlers = {
  readonly onApplyProject: (() => void) | undefined
  readonly onOpenBrowser: (() => void) | undefined
  readonly onOpenTaskManager: (() => void) | undefined
  readonly onOpenTerminal: (() => void) | undefined
}

export type TaskHandlers = {
  readonly logs: string
  readonly onIncludeDefaultChange: (include: boolean) => void
  readonly onLoadLogs: (pid: number) => void
  readonly onRefresh: () => void
  readonly onStopTask: (pid: number) => void
  readonly refreshTasks: (include: boolean) => void
  readonly snapshot: ContainerTaskSnapshot | null
  readonly taskIncludeDefault: boolean
}

const confirmApplyProject = (label: string): boolean => {
  const dialog = globalThis.confirm
  return typeof dialog === "function"
    && dialog(
      `Apply docker-git config to ${label}? This restarts the container and ends active SSH sessions and in-container browsers.`
    )
}

const browserStatusMessage = (browser: ProjectBrowserSession): string => {
  if (browser.status !== "running") {
    return `Browser runtime is ${browser.status}. Enable Playwright MCP and start the project first.`
  }
  const noVncUrl = projectBrowserNoVncUrl(browser)
  return openUrl(noVncUrl)
    ? `Browser opened. CDP endpoint: ${projectBrowserCdpUrl(browser)}.`
    : `Browser popup was blocked. Open ${noVncUrl} manually. CDP endpoint: ${projectBrowserCdpUrl(browser)}.`
}

const runOpenBrowser = (projectId: string, setMessage: StateMessageUpdater): void => {
  void Effect.runPromise(
    loadProjectBrowser(projectId).pipe(
      Effect.match({
        onFailure: (error) => {
          setMessage(`Failed to open browser: ${error}`)
        },
        onSuccess: (browser) => {
          setMessage(browserStatusMessage(browser))
        }
      })
    )
  )
}

const runApplyProject = (
  projectId: string,
  projectLabel: string,
  setMessage: StateMessageUpdater
): void => {
  if (!confirmApplyProject(projectLabel)) {
    return
  }
  void Effect.runPromise(
    applyProject(projectId).pipe(
      Effect.match({
        onFailure: (error) => {
          setMessage(`Apply failed: ${error}`)
        },
        onSuccess: (applied) => {
          setMessage(`Applied ${applied.displayName}.`)
        }
      })
    )
  )
}

export const newProjectTerminalUrl = (origin: string, projectKey: string, sessionId: string): string =>
  `${origin}${projectSshRoutePath(projectKey, sessionId)}`

const handleTerminalCreated = (projectKey: string, sessionId: string, setMessage: StateMessageUpdater): void => {
  const targetUrl = newProjectTerminalUrl(globalThis.location.origin, projectKey, sessionId)
  if (!openUrl(targetUrl)) {
    setMessage(`New terminal popup was blocked. Open ${targetUrl} manually.`)
  }
}

const runOpenTerminal = (projectKey: string, setMessage: StateMessageUpdater): void => {
  void Effect.runPromise(
    createProjectTerminalSession(projectKey).pipe(
      Effect.match({
        onFailure: (error) => {
          setMessage(`Failed to open new terminal: ${error}`)
        },
        onSuccess: (created) => {
          handleTerminalCreated(projectKey, created.session.id, setMessage)
        }
      })
    )
  )
}

export type ProjectActionHandlersArgs = {
  readonly onOpenTaskManagerRequest: () => void
  readonly projectId: string | undefined
  readonly projectKey: string | undefined
  readonly projectLabel: string
  readonly setMessage: StateMessageUpdater
}

export const useProjectActionHandlers = (
  { onOpenTaskManagerRequest, projectId, projectKey, projectLabel, setMessage }: ProjectActionHandlersArgs
): ProjectHandlers => ({
  onApplyProject: projectId === undefined ? undefined : () => {
    runApplyProject(projectId, projectLabel, setMessage)
  },
  onOpenBrowser: projectId === undefined ? undefined : () => {
    runOpenBrowser(projectId, setMessage)
  },
  onOpenTaskManager: projectId === undefined ? undefined : onOpenTaskManagerRequest,
  onOpenTerminal: projectId === undefined || projectKey === undefined
    ? undefined
    : () => {
      runOpenTerminal(projectKey, setMessage)
    }
})

const runRefreshTasks = (
  projectId: string,
  include: boolean,
  setSnapshot: Dispatch<SetStateAction<ContainerTaskSnapshot | null>>,
  setMessage: StateMessageUpdater
): void => {
  void Effect.runPromise(
    loadProjectTasks(projectId, include).pipe(
      Effect.match({
        onFailure: (error) => {
          setMessage(`Failed to load tasks: ${error}`)
        },
        onSuccess: (next) => {
          setSnapshot(next)
        }
      })
    )
  )
}

const runStopTask = (
  projectId: string,
  pid: number,
  setMessage: StateMessageUpdater,
  onAfterStop: () => void
): void => {
  void Effect.runPromise(
    stopProjectTask(projectId, pid).pipe(
      Effect.match({
        onFailure: (error) => {
          setMessage(`Failed to stop task ${pid}: ${error}`)
        },
        onSuccess: () => {
          onAfterStop()
        }
      })
    )
  )
}

const runLoadLogs = (
  projectId: string,
  pid: number,
  setLogs: Dispatch<SetStateAction<string>>,
  setMessage: StateMessageUpdater
): void => {
  void Effect.runPromise(
    loadProjectTaskLogs(projectId, pid).pipe(
      Effect.match({
        onFailure: (error) => {
          setMessage(`Failed to load logs for ${pid}: ${error}`)
        },
        onSuccess: (output) => {
          setLogs(output)
        }
      })
    )
  )
}

export type TaskManagerHandlersArgs = {
  readonly projectId: string | undefined
  readonly setMessage: StateMessageUpdater
}

export const useTaskManagerHandlers = (
  { projectId, setMessage }: TaskManagerHandlersArgs
): TaskHandlers => {
  const [snapshot, setSnapshot] = useState<ContainerTaskSnapshot | null>(null)
  const [logs, setLogs] = useState<string>("")
  const [taskIncludeDefault, setTaskIncludeDefault] = useState(false)

  const refreshTasks = useCallback((include: boolean) => {
    if (projectId !== undefined) {
      runRefreshTasks(projectId, include, setSnapshot, setMessage)
    }
  }, [projectId, setMessage])

  const onStopTask = useCallback((pid: number) => {
    if (projectId !== undefined) {
      runStopTask(projectId, pid, setMessage, () => {
        refreshTasks(taskIncludeDefault)
      })
    }
  }, [projectId, refreshTasks, setMessage, taskIncludeDefault])

  const onLoadLogs = useCallback((pid: number) => {
    if (projectId !== undefined) {
      runLoadLogs(projectId, pid, setLogs, setMessage)
    }
  }, [projectId, setMessage])

  const onIncludeDefaultChange = useCallback((include: boolean) => {
    setTaskIncludeDefault(include)
    refreshTasks(include)
  }, [refreshTasks])

  const onRefresh = useCallback(() => {
    refreshTasks(taskIncludeDefault)
  }, [refreshTasks, taskIncludeDefault])

  return {
    logs,
    onIncludeDefaultChange,
    onLoadLogs,
    onRefresh,
    onStopTask,
    refreshTasks,
    snapshot,
    taskIncludeDefault
  }
}
