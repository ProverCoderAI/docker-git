import { openSelectedProjectBrowser } from "./actions-browser.js"
import { openSelectedProjectDatabaseEditor } from "./actions-databases.js"
import { appendOutputLine, appendOutputLineHandler, notifyProjectEventRateLimit } from "./actions-output.js"
import { openSelectedProjectPort } from "./actions-port-forwards.js"
import {
  type BrowserActionContext,
  confirmAction,
  projectActionLabel,
  requireSelectedProjectId,
  requireSelectedProjectKey,
  withBusy,
  withSelectedProjectBusy
} from "./actions-shared.js"
import { loadSelectedProjectTasks } from "./actions-tasks.js"
import {
  applyAllProjects,
  applyProject,
  type ApiEvent,
  deleteProject,
  downAllProjects,
  downProject,
  loadProjectDetails,
  loadProjectLogs,
  loadProjectPs,
  loadProjectTerminalSession,
  startProjectTerminalSession
} from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import { openProjectEventStream } from "./project-events.js"
import { outputScreen } from "./screen.js"
import { buildPendingProjectActiveTerminalSession, buildProjectActiveTerminalSession } from "./terminal.js"

export { submitCreateInputs } from "./actions-project-create.js"

export const loadSelectedProjectInfo = (
  context: BrowserActionContext,
  options?: {
    readonly silent?: boolean
  }
) => {
  withSelectedProjectBusy({
    context,
    effect: loadProjectDetails,
    label: "Loading project info",
    onMissing: () => {
      context.setSelectedProject(null)
    },
    onSuccess: (project) => {
      context.setSelectedProject(project)
      if (options?.silent !== true) {
        context.setMessage(`Loaded ${project.displayName}.`)
      }
    }
  })
}

export const connectSelectedProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  const projectKey = requireSelectedProjectKey(context)
  if (projectId === null || projectKey === null) {
    return
  }
  connectProjectById(projectId, context, projectKey)
}

const resolveProjectTerminalKey = (
  projectId: string,
  context: BrowserActionContext,
  projectKey?: string
): string | null => {
  if (projectKey !== undefined && projectKey.trim().length > 0) {
    return projectKey
  }
  if (context.selectedProjectId === projectId && context.selectedProjectKey !== null) {
    return context.selectedProjectKey
  }
  context.setMessage(`Project key is missing for ${projectId}.`)
  return null
}

const randomHex = (bytes: number): string => {
  const getRandomValues = globalThis.crypto?.getRandomValues
  if (typeof getRandomValues === "function") {
    const values = new Uint8Array(bytes)
    getRandomValues.call(globalThis.crypto, values)
    return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("")
  }

  let fallback = ""
  while (fallback.length < bytes * 2) {
    fallback += Math.floor(Math.random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, "0")
  }
  return fallback.slice(0, bytes * 2)
}

const createPendingTerminalSessionId = (): string => {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto)
  }

  return `pending-${Date.now().toString(16)}-${randomHex(8)}`
}

const readEventPayloadString = (
  event: ApiEvent,
  key: string
): string | null => {
  const payload = event.payload
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  const value = Object.entries(payload).find(([name]) => name === key)?.[1]
  return typeof value === "string" ? value : null
}

const readTerminalSessionCreatedId = (
  event: ApiEvent,
  requestId: string
): string | null => {
  if (event.type !== "project.ssh.session") {
    return null
  }
  if (readEventPayloadString(event, "phase") !== "created") {
    return null
  }
  if (readEventPayloadString(event, "requestId") !== requestId) {
    return null
  }
  return readEventPayloadString(event, "sessionId")
}

const readTerminalStartupFailure = (
  event: ApiEvent,
  requestId: string
): string | null => {
  if (event.type !== "project.deployment.status") {
    return null
  }
  if (readEventPayloadString(event, "phase") !== "ssh.failed") {
    return null
  }
  if (readEventPayloadString(event, "requestId") !== requestId) {
    return null
  }
  return readEventPayloadString(event, "message") ?? "SSH session startup failed."
}

export const connectProjectById = (
  projectId: string,
  context: BrowserActionContext,
  projectKey?: string
) => {
  const resolvedProjectKey = resolveProjectTerminalKey(projectId, context, projectKey)
  if (resolvedProjectKey === null) {
    return
  }
  const pendingSessionId = createPendingTerminalSessionId()
  const pendingSessionCreatedAt = new Date().toISOString()
  const projectDisplayName = context.selectedProjectId === projectId && context.selectedProjectName !== null
    ? context.selectedProjectName
    : resolvedProjectKey
  let pendingSessionFinalized = false
  let attachedSessionId: string | null = null
  const handleOutputLine = appendOutputLineHandler(context)
  const renderPendingTerminalSession = (
    message?: string,
    phase: "connecting" | "error" = "connecting"
  ) =>
    buildPendingProjectActiveTerminalSession({
      createdAt: pendingSessionCreatedAt,
      onExit: context.reloadDashboard,
      pendingSessionId,
      phase,
      projectDisplayName,
      projectId,
      projectKey: resolvedProjectKey,
      ...(message === undefined ? {} : { message })
    })
  context.setSelectedProjectId(projectId)
  context.setOutput("")
  appendOutputLine(context, "[ssh.prepare] Preparing SSH session")
  context.addTerminalSession(renderPendingTerminalSession())
  let stream: ReturnType<typeof openProjectEventStream> | null = null
  const closeStream = () => {
    stream?.close()
    stream = null
  }
  const attachCreatedSession = (sessionId: string) => {
    if (attachedSessionId !== null) {
      return
    }
    attachedSessionId = sessionId
    withBusy({
      context,
      effect: loadProjectTerminalSession(resolvedProjectKey, sessionId),
      label: "Attaching SSH terminal",
      onFailure: (error) => {
        pendingSessionFinalized = true
        appendOutputLine(context, `[error] ${error}`)
        context.addTerminalSession(renderPendingTerminalSession(error, "error"))
        closeStream()
      },
      onSuccess: (session) => {
        pendingSessionFinalized = true
        context.reloadDashboard()
        context.closeTerminalSession(pendingSessionId)
        context.addTerminalSession(buildProjectActiveTerminalSession({
          onExit: context.reloadDashboard,
          onReady: context.reloadDashboard,
          projectDisplayName,
          projectId,
          projectKey: resolvedProjectKey,
          session
        }))
        context.setMessage(`Project is ready. SSH terminal is connecting for ${projectDisplayName}.`)
        closeStream()
      }
    })
  }
  withBusy({
    context,
    effect: startProjectTerminalSession(resolvedProjectKey, pendingSessionId),
    label: "Opening SSH terminal",
    onFailure: (error) => {
      pendingSessionFinalized = true
      appendOutputLine(context, `[error] ${error}`)
      context.addTerminalSession(renderPendingTerminalSession(error, "error"))
    },
    onSuccess: (accepted) => {
      appendOutputLine(context, `[ssh.prepare] SSH terminal request accepted (${accepted.requestId})`)
      context.setMessage(`SSH terminal startup is running for ${projectDisplayName}. Live logs are open.`)
      stream = openProjectEventStream(projectId, {
        initialCursor: accepted.cursor,
        onEvent: (event) => {
          const failure = readTerminalStartupFailure(event, accepted.requestId)
          if (failure !== null) {
            pendingSessionFinalized = true
            appendOutputLine(context, `[error] ${failure}`)
            context.addTerminalSession(renderPendingTerminalSession(failure, "error"))
            context.setMessage(failure)
            closeStream()
            return
          }

          const sessionId = readTerminalSessionCreatedId(event, accepted.requestId)
          if (sessionId !== null) {
            attachCreatedSession(sessionId)
          }
        },
        onLine: (line) => {
          handleOutputLine(line)
          if (!pendingSessionFinalized) {
            context.addTerminalSession(renderPendingTerminalSession(line))
          }
        },
        onRateLimit: () => {
          notifyProjectEventRateLimit(context)
        }
      })
    }
  })
}

const applyProjectConfirmMessage = (label: string): string =>
  `Apply docker-git config to ${label}? This restarts the container and ends active SSH sessions and in-container browsers.`

export const applyProjectById = (
  projectId: string,
  context: BrowserActionContext
) => {
  const label = context.selectedProjectId === projectId
    ? projectActionLabel(context)
    : projectId
  if (!confirmAction(applyProjectConfirmMessage(label))) {
    return
  }
  context.setSelectedProjectId(projectId)
  withBusy({
    context,
    effect: applyProject(projectId),
    label: "Applying project",
    onSuccess: (project) => {
      context.reloadDashboard()
      context.setSelectedProject(project)
      context.setMessage(`Applied ${project.displayName}.`)
    }
  })
}

export const applySelectedProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  applyProjectById(projectId, context)
}

export const attachProjectTerminalById = (
  projectId: string,
  projectKey: string,
  projectDisplayName: string,
  sessionId: string,
  context: BrowserActionContext
) => {
  const resolvedProjectKey = resolveProjectTerminalKey(projectId, context, projectKey)
  if (resolvedProjectKey === null) {
    return
  }
  context.setSelectedProjectId(projectId)
  withBusy({
    context,
    effect: loadProjectTerminalSession(resolvedProjectKey, sessionId),
    label: "Attaching SSH terminal",
    onSuccess: (session) => {
      context.addTerminalSession(buildProjectActiveTerminalSession({
        onExit: context.reloadDashboard,
        onReady: context.reloadDashboard,
        projectDisplayName,
        projectId,
        projectKey: resolvedProjectKey,
        session
      }))
      context.setMessage(`Attached SSH terminal for ${projectDisplayName}.`)
    }
  })
}

const runProjectOutputAction = (
  context: BrowserActionContext,
  effect: (projectId: string) => ReturnType<typeof loadProjectPs>,
  label: string,
  successMessage: string
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: effect(projectId),
    label,
    onSuccess: (output) => {
      context.setOutput(output)
      context.setActiveScreen(outputScreen())
      context.setMessage(successMessage)
    }
  })
}

const runDownProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null || !confirmAction(`Stop ${projectActionLabel(context)}?`)) {
    return
  }
  withBusy({
    context,
    effect: downProject(projectId),
    label: "Stopping project",
    onSuccess: () => {
      context.reloadDashboard()
      context.setMessage("Project stopped.")
    }
  })
}

const runDeleteProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null || !confirmAction(`Delete ${projectActionLabel(context)}?`)) {
    return
  }
  withBusy({
    context,
    effect: deleteProject(projectId),
    label: "Deleting project",
    onSuccess: () => {
      context.reloadDashboard()
      context.setOutput("")
      context.setProjectAuthSnapshot(null)
      context.setSelectedProject(null)
      context.setSelectedProjectId(null)
      context.setMessage("Project deleted.")
    }
  })
}

const runDownAllProjects = (context: BrowserActionContext) => {
  if (!confirmAction("Stop all docker-git projects?")) {
    return
  }
  withBusy({
    context,
    effect: downAllProjects(),
    label: "Stopping all projects",
    onSuccess: () => {
      context.reloadDashboard()
      context.setMessage("All projects were asked to stop.")
    }
  })
}

export const runApplyAllProjects = (context: BrowserActionContext) => {
  if (!confirmAction("Apply docker-git config to all projects?")) {
    return
  }
  withBusy({
    context,
    effect: applyAllProjects(false),
    label: "Applying all projects",
    onSuccess: () => {
      context.reloadDashboard()
      context.setMessage("Applied docker-git config to all projects.")
    }
  })
}

export const runProjectMenuAction = (
  currentMenu: Exclude<BrowserMenuTag, "Auth" | "ProjectAuth">,
  context: BrowserActionContext
) => {
  if (currentMenu === "Create") {
    context.setMessage("Create mode is active. Paste URL or URL + flags, Enter = next, Shift+Enter = quick create.")
    return
  }
  if (currentMenu === "Select") {
    connectSelectedProject(context)
    return
  }
  if (currentMenu === "Info") {
    loadSelectedProjectInfo(context)
    return
  }
  if (currentMenu === "Ports") {
    openSelectedProjectPort(context)
    return
  }
  if (currentMenu === "Databases") {
    openSelectedProjectDatabaseEditor(context)
    return
  }
  if (currentMenu === "Browser") {
    openSelectedProjectBrowser(context)
    return
  }
  if (currentMenu === "Tasks") {
    loadSelectedProjectTasks(context)
    return
  }
  runProjectMenuCommand(currentMenu, context)
}

const runProjectMenuCommand = (
  currentMenu: Exclude<
    BrowserMenuTag,
    "Auth" | "ProjectAuth" | "Browser" | "Create" | "Databases" | "Select" | "Info" | "Ports" | "Tasks"
  >,
  context: BrowserActionContext
) => {
  if (currentMenu === "Status") {
    runProjectOutputAction(context, loadProjectPs, "Loading docker compose ps", "docker compose ps loaded.")
    return
  }
  if (currentMenu === "Logs") {
    runProjectOutputAction(context, loadProjectLogs, "Loading logs", "Logs loaded.")
    return
  }
  if (currentMenu === "Down") {
    runDownProject(context)
    return
  }
  if (currentMenu === "DownAll") {
    runDownAllProjects(context)
    return
  }
  if (currentMenu === "Delete") {
    runDeleteProject(context)
    return
  }
  globalThis.close()
  context.setMessage("Quit requested. If the browser blocked window.close(), close the tab manually.")
}
