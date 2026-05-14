import { openSelectedProjectBrowser } from "./actions-browser.js"
import { openSelectedProjectDatabaseEditor } from "./actions-databases.js"
import { readEventPayloadString } from "./actions-event-payload.js"
import { appendOutputLine, appendOutputLineHandler, notifyProjectEventRateLimit } from "./actions-output.js"
import { openSelectedProjectPort } from "./actions-port-forwards.js"
import { loadSelectedProjectPrompts } from "./actions-prompts.js"
import {
  type BrowserActionContext,
  confirmAction,
  projectActionLabel,
  requireSelectedProjectId,
  requireSelectedProjectKey,
  withBusy,
  withSelectedProjectBusy
} from "./actions-shared.js"
import { loadSelectedProjectSkills } from "./actions-skills.js"
import { loadSelectedProjectTasks } from "./actions-tasks.js"
import {
  type ApiEvent,
  applyAllProjects,
  applyProject,
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
  if (typeof globalThis.crypto.getRandomValues === "function") {
    const values = new Uint8Array(bytes)
    globalThis.crypto.getRandomValues(values)
    return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("")
  }

  return Date.now().toString(16).padStart(bytes * 2, "0").slice(0, bytes * 2)
}

const formatUuidV4 = (hex: string): string => {
  const value = hex.padEnd(32, "0").slice(0, 32)
  const variant = ((Number.parseInt(value.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0")
  const segments = [
    value.slice(0, 8),
    value.slice(8, 12),
    `4${value.slice(13, 16)}`,
    `${variant}${value.slice(18, 20)}`,
    value.slice(20, 32)
  ]
  return segments.join("-")
}

const createPendingTerminalSessionId = (): string => {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  return formatUuidV4(randomHex(16))
}

type ProjectActiveTerminalSessionArgs = Omit<
  Parameters<typeof buildProjectActiveTerminalSession>[0],
  "onExit" | "onReady"
>

const addProjectTerminalSession = (
  context: BrowserActionContext,
  args: ProjectActiveTerminalSessionArgs
) => {
  context.addTerminalSession(buildProjectActiveTerminalSession({
    ...args,
    onExit: context.reloadDashboard,
    onReady: context.reloadDashboard
  }))
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
  const showPendingTerminalError = (error: string) => {
    pendingSessionFinalized = true
    appendOutputLine(context, `[error] ${error}`)
    context.addTerminalSession(renderPendingTerminalSession(error, "error"))
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
        showPendingTerminalError(error)
        closeStream()
      },
      onSuccess: (session) => {
        pendingSessionFinalized = true
        context.reloadDashboard()
        context.closeTerminalSession(pendingSessionId)
        addProjectTerminalSession(context, {
          projectDisplayName,
          projectId,
          projectKey: resolvedProjectKey,
          session
        })
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
      showPendingTerminalError(error)
    },
    onSuccess: (accepted) => {
      appendOutputLine(context, `[ssh.prepare] SSH terminal request accepted (${accepted.requestId})`)
      context.setMessage(`SSH terminal startup is running for ${projectDisplayName}. Live logs are open.`)
      stream = openProjectEventStream(projectId, {
        initialCursor: accepted.cursor,
        onEvent: (event) => {
          const failure = readTerminalStartupFailure(event, accepted.requestId)
          if (failure !== null) {
            showPendingTerminalError(failure)
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

const applyProjectConfirmMessage = (
  label: string,
  gpu?: "none" | "all"
): string =>
  gpu === undefined
    ? `Apply docker-git config to ${label}? This restarts the container and ends active SSH sessions and in-container browsers.`
    : `Apply docker-git config to ${label} with GPU ${gpu}? This restarts the container and ends active SSH sessions and in-container browsers.`

export const applyProjectById = (
  projectId: string,
  context: BrowserActionContext,
  gpu?: "none" | "all"
) => {
  const label = context.selectedProjectId === projectId
    ? projectActionLabel(context)
    : projectId
  if (!confirmAction(applyProjectConfirmMessage(label, gpu))) {
    return
  }
  context.setSelectedProjectId(projectId)
  withBusy({
    context,
    effect: applyProject(projectId, gpu === undefined ? undefined : { gpu }),
    label: "Applying project",
    onSuccess: (project) => {
      context.reloadDashboard()
      context.setSelectedProject(project)
      context.setMessage(`Applied ${project.displayName} (GPU ${project.gpu}).`)
    }
  })
}

export const applySelectedProject = (
  context: BrowserActionContext,
  gpu?: "none" | "all"
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  applyProjectById(projectId, context, gpu)
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
      addProjectTerminalSession(context, {
        projectDisplayName,
        projectId,
        projectKey: resolvedProjectKey,
        session
      })
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
  if (currentMenu === "Prompts") {
    loadSelectedProjectPrompts(context)
    return
  }
  if (currentMenu === "Skills") {
    loadSelectedProjectSkills(context)
    return
  }
  runProjectMenuCommand(currentMenu, context)
}

const runProjectMenuCommand = (
  currentMenu: Exclude<
    BrowserMenuTag,
    | "Auth"
    | "ProjectAuth"
    | "Browser"
    | "Create"
    | "Databases"
    | "Select"
    | "Info"
    | "Ports"
    | "Prompts"
    | "Skills"
    | "Tasks"
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
