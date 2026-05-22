import { readEventPayloadString } from "./actions-event-payload.js"
import { appendOutputLine, appendOutputLineHandler, notifyProjectEventRateLimit } from "./actions-output.js"
import { type BrowserActionContext, withBusy } from "./actions-shared.js"
import type { StartProjectTerminalSessionAccepted } from "./api-types.js"
import { type ApiEvent, loadProjectTerminalSession, startProjectTerminalSession } from "./api.js"
import { openProjectEventStream } from "./project-events.js"
import { buildPendingProjectActiveTerminalSession, buildProjectActiveTerminalSession } from "./terminal.js"

type ProjectActiveTerminalSessionArgs = Omit<
  Parameters<typeof buildProjectActiveTerminalSession>[0],
  "onExit" | "onReady"
>

type ConnectProjectRuntime = {
  attachedSessionId: string | null
  pendingSessionFinalized: boolean
  readonly pendingSessionCreatedAt: string
  readonly pendingSessionId: string
  readonly projectDisplayName: string
  readonly projectId: string
  readonly projectKey: string
  stream: ReturnType<typeof openProjectEventStream> | null
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
  const variant = ((Number.parseInt(value.slice(16, 18), 16) & 0x3F) | 0x80)
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

const createConnectProjectRuntime = (
  projectId: string,
  context: BrowserActionContext,
  projectKey?: string
): ConnectProjectRuntime | null => {
  const resolvedProjectKey = resolveProjectTerminalKey(projectId, context, projectKey)
  if (resolvedProjectKey === null) {
    return null
  }
  return {
    attachedSessionId: null,
    pendingSessionCreatedAt: new Date().toISOString(),
    pendingSessionFinalized: false,
    pendingSessionId: createPendingTerminalSessionId(),
    projectDisplayName: context.selectedProjectId === projectId && context.selectedProjectName !== null
      ? context.selectedProjectName
      : resolvedProjectKey,
    projectId,
    projectKey: resolvedProjectKey,
    stream: null
  }
}

const renderPendingTerminalSession = (
  context: BrowserActionContext,
  runtime: ConnectProjectRuntime,
  message?: string,
  phase: "connecting" | "error" = "connecting"
) =>
  buildPendingProjectActiveTerminalSession({
    createdAt: runtime.pendingSessionCreatedAt,
    onExit: context.reloadDashboard,
    pendingSessionId: runtime.pendingSessionId,
    phase,
    projectDisplayName: runtime.projectDisplayName,
    projectId: runtime.projectId,
    projectKey: runtime.projectKey,
    ...(message === undefined ? {} : { message })
  })

const closeStream = (runtime: ConnectProjectRuntime): void => {
  runtime.stream?.close()
  runtime.stream = null
}

const showPendingTerminalError = (
  context: BrowserActionContext,
  runtime: ConnectProjectRuntime,
  error: string
): void => {
  runtime.pendingSessionFinalized = true
  appendOutputLine(context, `[error] ${error}`)
  context.addTerminalSession(renderPendingTerminalSession(context, runtime, error, "error"))
}

const attachCreatedSession = (
  context: BrowserActionContext,
  runtime: ConnectProjectRuntime,
  sessionId: string
): void => {
  if (runtime.attachedSessionId !== null) {
    return
  }
  runtime.attachedSessionId = sessionId
  withBusy({
    context,
    effect: loadProjectTerminalSession(runtime.projectKey, sessionId),
    label: "Attaching SSH terminal",
    onFailure: (error) => {
      showPendingTerminalError(context, runtime, error)
      closeStream(runtime)
    },
    onSuccess: (session) => {
      runtime.pendingSessionFinalized = true
      context.reloadDashboard()
      context.closeTerminalSession(runtime.pendingSessionId)
      addProjectTerminalSession(context, { ...runtime, session })
      context.setMessage(`Project is ready. SSH terminal is connecting for ${runtime.projectDisplayName}.`)
      closeStream(runtime)
    }
  })
}

const handleProjectEvent = (
  context: BrowserActionContext,
  runtime: ConnectProjectRuntime,
  requestId: string,
  event: ApiEvent
): void => {
  const failure = readTerminalStartupFailure(event, requestId)
  if (failure !== null) {
    showPendingTerminalError(context, runtime, failure)
    context.setMessage(failure)
    closeStream(runtime)
    return
  }

  const sessionId = readTerminalSessionCreatedId(event, requestId)
  if (sessionId !== null) {
    attachCreatedSession(context, runtime, sessionId)
  }
}

const openTerminalEventStream = (
  context: BrowserActionContext,
  runtime: ConnectProjectRuntime,
  accepted: StartProjectTerminalSessionAccepted
): void => {
  const handleOutputLine = appendOutputLineHandler(context)
  runtime.stream = openProjectEventStream(runtime.projectId, {
    initialCursor: accepted.cursor,
    onEvent: (event) => {
      handleProjectEvent(context, runtime, accepted.requestId, event)
    },
    onLine: (line) => {
      handleOutputLine(line)
      if (!runtime.pendingSessionFinalized) {
        context.addTerminalSession(renderPendingTerminalSession(context, runtime, line))
      }
    },
    onRateLimit: () => {
      notifyProjectEventRateLimit(context)
    }
  })
}

const startTerminalSession = (context: BrowserActionContext, runtime: ConnectProjectRuntime): void => {
  withBusy({
    context,
    effect: startProjectTerminalSession(runtime.projectKey, runtime.pendingSessionId),
    label: "Opening SSH terminal",
    onFailure: (error) => {
      showPendingTerminalError(context, runtime, error)
    },
    onSuccess: (accepted) => {
      appendOutputLine(context, `[ssh.prepare] SSH terminal request accepted (${accepted.requestId})`)
      context.setMessage(`SSH terminal startup is running for ${runtime.projectDisplayName}. Live logs are open.`)
      openTerminalEventStream(context, runtime, accepted)
    }
  })
}

export const connectProjectById = (
  projectId: string,
  context: BrowserActionContext,
  projectKey?: string
) => {
  const runtime = createConnectProjectRuntime(projectId, context, projectKey)
  if (runtime === null) {
    return
  }
  context.setSelectedProjectId(projectId)
  context.setOutput("")
  appendOutputLine(context, "[ssh.prepare] Preparing SSH session")
  context.addTerminalSession(renderPendingTerminalSession(context, runtime))
  startTerminalSession(context, runtime)
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
      addProjectTerminalSession(context, { projectDisplayName, projectId, projectKey: resolvedProjectKey, session })
      context.setMessage(`Attached SSH terminal for ${projectDisplayName}.`)
    }
  })
}
