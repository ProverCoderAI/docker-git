import { Effect } from "effect"
import { type Dispatch, type SetStateAction, useCallback, useState } from "react"

import { openPreparedSkillerLaunch } from "./actions-skiller.js"
import {
  applyProject,
  type ContainerTaskSnapshot,
  createProjectTerminalSession,
  loadProjectTaskLogs,
  loadProjectTasks,
  openSkiller,
  projectBrowserCdpUrl,
  projectBrowserNoVncUrl,
  type ProjectBrowserSession,
  startProjectBrowser,
  stopProjectTask
} from "./api.js"
import { openUrl, prepareOpenUrl } from "./open-url.js"
import { projectSshRoutePath } from "./terminal.js"

export type StateMessageUpdater = (message: string | null) => void

export type ProjectHandlers = {
  readonly onApplyProject: (() => void) | undefined
  readonly onOpenBrowser: (() => void) | undefined
  readonly onOpenSkiller: (() => void) | undefined
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

const browserStatusMessage = (browser: ProjectBrowserSession, opened: boolean): string => {
  if (browser.status !== "running") {
    return `Browser runtime is ${browser.status}. Enable Playwright MCP and start the project first.`
  }
  const noVncUrl = projectBrowserNoVncUrl(browser)
  return opened
    ? `Browser opened. CDP endpoint: ${projectBrowserCdpUrl(browser)}.`
    : `Browser popup was blocked. Open ${noVncUrl} manually. CDP endpoint: ${projectBrowserCdpUrl(browser)}.`
}

const runOpenBrowser = (projectId: string, setMessage: StateMessageUpdater): void => {
  const preparedUrl = prepareOpenUrl()
  void Effect.runPromise(
    startProjectBrowser(projectId).pipe(
      Effect.match({
        onFailure: (error) => {
          preparedUrl.close()
          setMessage(`Failed to open browser: ${error}`)
        },
        onSuccess: (browser) => {
          if (browser.status !== "running") {
            preparedUrl.close()
            setMessage(browserStatusMessage(browser, false))
            return
          }
          setMessage(browserStatusMessage(browser, preparedUrl.navigate(projectBrowserNoVncUrl(browser))))
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

const runOpenSkiller = (
  projectKey: string,
  terminalSessionId: string,
  setMessage: StateMessageUpdater
): void => {
  const preparedUrl = prepareOpenUrl()
  setMessage("Opening Skiller...")
  void Effect.runPromise(
    openSkiller(projectKey, terminalSessionId).pipe(
      Effect.match({
        onFailure: (error) => {
          preparedUrl.close()
          setMessage(`Failed to open Skiller: ${error}`)
        },
        onSuccess: (launch) => {
          setMessage(openPreparedSkillerLaunch(launch, preparedUrl))
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
  readonly terminalSessionId: string | undefined
}

const projectAction = (
  projectId: string | undefined,
  action: (projectId: string) => void
): (() => void) | undefined =>
  projectId === undefined
    ? undefined
    : () => {
      action(projectId)
    }

const projectKeyAction = (
  projectId: string | undefined,
  projectKey: string | undefined,
  action: (projectKey: string) => void
): (() => void) | undefined =>
  projectId === undefined || projectKey === undefined
    ? undefined
    : () => {
      action(projectKey)
    }

const projectTerminalAction = (
  projectId: string | undefined,
  projectKey: string | undefined,
  terminalSessionId: string | undefined,
  action: (projectKey: string, terminalSessionId: string) => void
): (() => void) | undefined => {
  if (projectId === undefined) return undefined
  if (projectKey === undefined) return undefined
  if (terminalSessionId === undefined) return undefined
  return () => { action(projectKey, terminalSessionId) }
}

export const useProjectActionHandlers = (
  { onOpenTaskManagerRequest, projectId, projectKey, projectLabel, setMessage, terminalSessionId }:
    ProjectActionHandlersArgs
): ProjectHandlers => ({
  onApplyProject: projectAction(projectId, (resolvedProjectId) => {
    runApplyProject(resolvedProjectId, projectLabel, setMessage)
  }),
  onOpenBrowser: projectAction(projectId, (resolvedProjectId) => {
    runOpenBrowser(resolvedProjectId, setMessage)
  }),
  onOpenSkiller: projectTerminalAction(projectId, projectKey, terminalSessionId, (resolvedProjectKey, sessionId) => {
    runOpenSkiller(resolvedProjectKey, sessionId, setMessage)
  }),
  onOpenTaskManager: projectAction(projectId, () => {
    onOpenTaskManagerRequest()
  }),
  onOpenTerminal: projectKeyAction(projectId, projectKey, (resolvedProjectKey) => {
    runOpenTerminal(resolvedProjectKey, setMessage)
  })
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
