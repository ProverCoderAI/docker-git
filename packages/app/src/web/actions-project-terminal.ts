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

export type ConnectProjectLifecycle = {
  readonly onFailure?: (error: string) => void
  readonly onSuccess?: (sessionId: string) => void
}

type ConnectProjectRuntime = {
  attachedSessionId: string | null
  pendingSessionFinalized: boolean
  readonly pendingSessionCreatedAt: string
  readonly pendingSessionId: string
  readonly projectDisplayName: string
  readonly projectId: string
  readonly projectKey: string
  readonly lifecycle: ConnectProjectLifecycle
  stream: ReturnType<typeof openProjectEventStream> | null
}

const missingProjectKeyMessage = (projectId: string): string => `Project key is missing for ${projectId}.`

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
  context.setMessage(missingProjectKeyMessage(projectId))
  return null
}

const randomHex = (bytes: number): string => {
  const webCrypto = "crypto" in globalThis ? crypto : null
  if (webCrypto !== null && typeof webCrypto.getRandomValues === "function") {
    const values = new Uint8Array(bytes)
    webCrypto.getRandomValues(values)
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
  const webCrypto = "crypto" in globalThis ? crypto : null
  if (webCrypto !== null && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID()
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
  projectKey: string | undefined,
  lifecycle: ConnectProjectLifecycle
): ConnectProjectRuntime | null => {
  const resolvedProjectKey = resolveProjectTerminalKey(projectId, context, projectKey)
  if (resolvedProjectKey === null) {
    return null
  }
  return {
    attachedSessionId: null,
    lifecycle,
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
    ...(message !== undefined && { message })
  })

const closeStream = (runtime: ConnectProjectRuntime): void => {
  runtime.stream?.close()
  runtime.stream = null
}

const showPendingTerminalError = (
  context: BrowserActionContext,
  runtime: ConnectProjectRuntime,
  error: string
): boolean => {
  const wasFinalized = runtime.pendingSessionFinalized
  if (wasFinalized) {
    return false
  }
  runtime.pendingSessionFinalized = true
  runtime.lifecycle.onFailure?.(error)
  appendOutputLine(context, `[error] ${error}`)
  context.addTerminalSession(renderPendingTerminalSession(context, runtime, error, "error"))
  return true
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
      const wasFinalized = runtime.pendingSessionFinalized
      runtime.pendingSessionFinalized = true
      context.reloadDashboard()
      context.closeTerminalSession(runtime.pendingSessionId)
      addProjectTerminalSession(context, { ...runtime, session })
      context.setMessage(`Project is ready. SSH terminal is connecting for ${runtime.projectDisplayName}.`)
      if (!wasFinalized) {
        runtime.lifecycle.onSuccess?.(session.id)
      }
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
    if (showPendingTerminalError(context, runtime, failure)) {
      context.setMessage(failure)
    }
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

/**
 * Starts a project SSH terminal session and attaches it after the backend emits the created event.
 *
 * @param projectId - Project identifier to connect.
 * @param context - Browser action context used for state updates and terminal tabs.
 * @param projectKey - Optional project key override used by deep links and menu actions.
 * @param lifecycle - Optional callbacks fired after terminal attach success or terminal startup failure.
 * @returns Nothing; state changes are emitted through `context` and lifecycle callbacks.
 * @pure false
 * @effect BrowserActionContext, backend start/load terminal Effects, project event stream.
 * @invariant Lifecycle success fires only after `loadProjectTerminalSession` succeeds.
 * @precondition `projectId` identifies a known project and `context` is a live browser action context.
 * @postcondition Failure before attach invokes `lifecycle.onFailure`; successful attach invokes `lifecycle.onSuccess`.
 * @complexity O(1) setup plus O(e) event handling where e is project stream events.
 * @throws Never
 */
// CHANGE: report project SSH connect outcomes separately from request startup
// WHY: browser deep-links must remain retryable until a real terminal attach succeeds
// QUOTE(ТЗ): "deep-link handled only after the connectProjectById pipeline signals a real success"
// REF: PR #342 CodeRabbit review
// SOURCE: n/a
// FORMAT THEOREM: attachSuccess(session) -> handled; startFailure(error) -> retryable
// PURITY: SHELL
// EFFECT: Effect<StartProjectTerminalSessionAccepted|TerminalSession, string> plus project event stream callbacks
// INVARIANT: each ConnectProjectRuntime finalizes its lifecycle outcome at most once
// COMPLEXITY: O(1) setup plus O(e) event handling where e is project stream events
export const connectProjectById = (
  projectId: string,
  context: BrowserActionContext,
  projectKey?: string,
  lifecycle: ConnectProjectLifecycle = {}
) => {
  const runtime = createConnectProjectRuntime(projectId, context, projectKey, lifecycle)
  if (runtime === null) {
    lifecycle.onFailure?.(missingProjectKeyMessage(projectId))
    return
  }
  context.setSelectedProjectId(projectId)
  context.setOutput("")
  appendOutputLine(context, "[ssh.prepare] Preparing SSH session")
  context.addTerminalSession(renderPendingTerminalSession(context, runtime))
  startTerminalSession(context, runtime)
}

/**
 * Attaches an existing project SSH terminal session to the browser terminal list.
 *
 * @param projectId - Project identifier whose session should become selected.
 * @param projectKey - Project key used to resolve the terminal session API route.
 * @param projectDisplayName - Human-readable project name used in the attached-session message.
 * @param sessionId - Existing backend terminal session identifier to load and attach.
 * @param context - Browser action context used for selection, busy state, and terminal tab updates.
 * @returns Nothing; state changes are emitted through `context`.
 * @pure false
 * @effect BrowserActionContext and `loadProjectTerminalSession` Effect.
 * @invariant A terminal tab is added only after `loadProjectTerminalSession` succeeds.
 * @precondition `sessionId` names an existing terminal session for the resolved project key.
 * @postcondition On success, the project is selected and the loaded session is added to terminal tabs.
 * @complexity O(1) setup plus O(1) backend session load.
 * @throws Never
 */
// CHANGE: document the existing-session attach shell contract
// WHY: CodeRabbit review requires explicit side-effect and invariant metadata for exported TS functions
// QUOTE(ТЗ): "Add a TSDoc comment block above the exported function attachProjectTerminalById"
// REF: PR #342 CodeRabbit review
// SOURCE: n/a
// FORMAT THEOREM: resolvedProjectKey != null && load(sessionId) succeeds -> terminalTab(sessionId) is added
// PURITY: SHELL
// EFFECT: Effect<TerminalSession, string> via loadProjectTerminalSession plus BrowserActionContext mutations
// INVARIANT: no terminal tab is added when project key resolution fails or session load fails
// COMPLEXITY: O(1) setup plus O(1) backend session load
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
