import { Effect } from "effect"
import { type CSSProperties, type JSX, useEffect, useState } from "react"

import { startProjectSshTunnel } from "./api-share-links.js"
import { deleteTerminalSessionByPath } from "./api.js"
import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"
import { TerminalTaskManagerBody } from "./app-ready-terminal-task-manager.js"
import type { TerminalPaneProps } from "./app-ready-terminal-types.js"
import { TerminalPanel } from "./panel-terminal.js"
import { type BrowserScreen, projectPickerScreen } from "./screen.js"
import type { TerminalExitInfo } from "./terminal-panel-runtime-types.js"
import { terminalSessionId } from "./terminal-state.js"
import { type ActiveTerminalSession, isPendingActiveTerminalSession } from "./terminal.js"

type TerminalPaneRuntime = {
  readonly browserProjectId: string | undefined
  readonly browserProjectKey: string | undefined
  readonly canOpenBrowser: boolean
  readonly pendingSession: boolean
  readonly sessionId: string
}

const activeTerminalPaneStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  overflow: "hidden"
}

const pendingTerminalBodyStyle: CSSProperties = {
  alignItems: "center",
  background: "rgba(8, 10, 13, 0.92)",
  boxSizing: "border-box",
  color: "#d6e5f7",
  display: "flex",
  height: "100%",
  justifyContent: "center",
  padding: "20px",
  textAlign: "center",
  whiteSpace: "pre-wrap"
}

const requestTerminalSessionClose = (
  closePath: string,
  onFailure: (error: string) => void,
  onSuccess: () => void
): void => {
  void Effect.runPromise(
    deleteTerminalSessionByPath(closePath).pipe(
      Effect.match({ onFailure, onSuccess })
    )
  )
}

const terminalReturnScreen = (session: ActiveTerminalSession): BrowserScreen =>
  session.closePath.startsWith("/auth/") ? { tag: "Auth" } : projectPickerScreen()

const projectSkillerAction = (
  projectKey: string | undefined,
  sessionId: string,
  onOpenSkiller: (projectKey?: string, sessionId?: string) => void
): (() => void) | undefined =>
  projectKey === undefined
    ? undefined
    : () => {
      onOpenSkiller(projectKey, sessionId)
    }

const PendingTerminalBody = ({ session }: { readonly session: ActiveTerminalSession }): JSX.Element | null => {
  if (!isPendingActiveTerminalSession(session)) {
    return null
  }

  const { pendingConnection } = session
  const hint = pendingConnection.phase === "error"
    ? "Close this tab or open a new terminal to retry."
    : "The terminal workspace is open. SSH will attach as soon as the project is ready."
  return (
    <div style={pendingTerminalBodyStyle}>
      <div>
        <div>{pendingConnection.message}</div>
        <div style={{ color: "#8fa6c4", fontSize: "12px", marginTop: "10px" }}>{hint}</div>
      </div>
    </div>
  )
}

const resolveTerminalPaneRuntime = (props: TerminalPaneProps): TerminalPaneRuntime => {
  const browserProjectId = props.terminalSession.browserProjectId
  return {
    browserProjectId,
    browserProjectKey: props.terminalSession.browserProjectKey,
    canOpenBrowser: canOpenProjectBrowser(props.projectBrowser, browserProjectId),
    pendingSession: isPendingActiveTerminalSession(props.terminalSession),
    sessionId: terminalSessionId(props.terminalSession)
  }
}

const terminalBodyContent = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): JSX.Element | undefined => {
  if (props.taskManagerOpen && runtime.browserProjectId !== undefined) {
    return (
      <TerminalTaskManagerBody
        onClose={props.onCloseTaskManager}
        onLoadProjectTaskLogs={props.onLoadProjectTaskLogs}
        onProjectTasksIncludeDefaultChange={props.onProjectTasksIncludeDefaultChange}
        onRefreshProjectTasks={props.onRefreshProjectTasks}
        onStopProjectTask={props.onStopProjectTask}
        project={props.project}
        projectTaskLogs={props.projectTaskLogs}
        projectTasks={props.projectTasks}
        projectTasksIncludeDefault={props.projectTasksIncludeDefault}
        selectedProjectSummary={props.selectedProjectSummary}
      />
    )
  }
  return runtime.pendingSession ? <PendingTerminalBody session={props.terminalSession} /> : undefined
}

const detachTerminalSession = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): void => {
  props.onTerminalClose(runtime.sessionId)
  if (props.singleSession) {
    props.onSetActiveScreen(terminalReturnScreen(props.terminalSession))
  }
}

const handleTerminalExit = (
  props: TerminalPaneProps,
  runtime: TerminalPaneRuntime,
  exitInfo: TerminalExitInfo
): void => {
  if (!props.terminalSession.closePath.startsWith("/auth/") || exitInfo.exitCode !== 0) {
    return
  }
  props.onAuthTerminalExitSuccess()
  detachTerminalSession(props, runtime)
}

const handleTerminalKill = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): void => {
  requestTerminalSessionClose(
    props.terminalSession.closePath,
    (error) => {
      props.onTerminalMessage(`Could not close SSH terminal ${props.terminalSession.session.id}: ${error}`)
    },
    () => {
      props.terminalSession.onExit?.()
      detachTerminalSession(props, runtime)
      props.onTerminalMessage(
        `${runtime.pendingSession ? "Closed pending" : "Killed"} SSH terminal: ${props.terminalSession.session.id}.`
      )
    }
  )
}

type VsCodeAccessInfo = {
  readonly sshUser: string
  readonly targetDir: string
  readonly sshPort: number
}

const buildVsCodeAccessInfo = (project: TerminalPaneProps["project"]): VsCodeAccessInfo | null => {
  if (project === null) return null
  return { sshUser: project.sshUser, targetDir: project.targetDir, sshPort: project.sshPort }
}

type CfTunnelState =
  | { readonly tag: "idle" }
  | { readonly tag: "loading" }
  | { readonly tag: "ready"; readonly hostname: string; readonly sshPassword: string }
  | { readonly tag: "failed" }

const hostSshConfig = (hostname: string, sshUser: string): string =>
  `Host ${hostname}\n  User ${sshUser}\n  ProxyCommand cloudflared access ssh --hostname %h\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null`

const directSshConfig = (host: string, sshPort: number, sshUser: string): string =>
  `Host ${host}-ssh\n  HostName ${host}\n  Port ${sshPort}\n  User ${sshUser}\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null`

const copyText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // ignore clipboard errors
  }
}

const vsCodePanelCodeStyle: CSSProperties = {
  background: "#0b1017",
  border: "1px solid #2a3640",
  borderRadius: "2px",
  color: "#a8c8f0",
  display: "block",
  fontFamily: "inherit",
  fontSize: "0.85em",
  marginBottom: "4px",
  marginTop: "4px",
  overflowX: "auto",
  padding: "6px 8px",
  whiteSpace: "pre"
}

const vsCodePanelCopyBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#7fdfff",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.85em",
  fontWeight: "bold",
  padding: "2px 6px"
}

const VsCodeAccessPanel = (
  {
    cfState,
    info,
    onClose,
    onRefresh,
    onRetry
  }: {
    readonly cfState: CfTunnelState
    readonly info: VsCodeAccessInfo
    readonly onClose: () => void
    readonly onRefresh: () => void
    readonly onRetry: () => void
  }
): JSX.Element => {
  const cfSshConfig = cfState.tag === "ready" ? hostSshConfig(cfState.hostname, info.sshUser) : null
  const cfSshCommand = cfState.tag === "ready"
    ? `ssh -o "ProxyCommand=cloudflared access ssh --hostname %h" ${info.sshUser}@${cfState.hostname}`
    : null
  const cfVscodeUri = cfState.tag === "ready"
    ? `vscode://ms-vscode-remote.remote-ssh/open?hostName=${
      encodeURIComponent(`${info.sshUser}@${cfState.hostname}`)
    }&folder=${encodeURIComponent(info.targetDir)}`
    : null
  const directHost = location.hostname
  const directConfig = directSshConfig(directHost, info.sshPort, info.sshUser)
  const directCommand = String
    .raw`ssh -p ${info.sshPort} -t ${info.sshUser}@${directHost} "cd ${info.targetDir} && exec \$SHELL"`
  const directVscodeUri = `vscode://ms-vscode-remote.remote-ssh/open?hostName=${
    encodeURIComponent(`${directHost}-ssh`)
  }&folder=${encodeURIComponent(info.targetDir)}`
  return (
    <div
      style={{
        background: "#0d1520",
        border: "1px solid #2a4060",
        borderRadius: "4px",
        boxSizing: "border-box",
        height: "100%",
        overflowY: "auto",
        padding: "12px 16px"
      }}
    >
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
        <div style={{ color: "#8be9fd", fontWeight: "bold" }}>VS Code / SSH access</div>
        <div style={{ display: "flex", gap: "4px" }}>
          {cfState.tag === "ready" && (
            <button onClick={onRefresh} style={{ ...vsCodePanelCopyBtnStyle, color: "#7fdfff" }} type="button">
              ↻ refresh
            </button>
          )}
          <button onClick={onClose} style={{ ...vsCodePanelCopyBtnStyle, color: "#f87171" }} type="button">
            ✕ close
          </button>
        </div>
      </div>

      {cfState.tag === "loading" && (
        <div style={{ color: "#8fa6c4", marginTop: "8px" }}>Starting Cloudflare tunnel…</div>
      )}

      {cfState.tag === "failed" && (
        <div style={{ marginTop: "8px" }}>
          <div style={{ color: "#f87171" }}>Tunnel failed to start.</div>
          <button
            onClick={onRetry}
            style={{ ...vsCodePanelCopyBtnStyle, color: "#7fdfff", marginTop: "4px" }}
            type="button"
          >
            Retry
          </button>
        </div>
      )}

      {cfState.tag === "ready" && (
        <>
          <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold" }}>Add to ~/.ssh/config</div>
          <div style={{ color: "#8fa6c4", fontSize: "0.78em" }}>
            requires <code style={{ color: "#a8c8f0" }}>cloudflared</code> installed on your machine
          </div>
          <code style={vsCodePanelCodeStyle}>{cfSshConfig}</code>
          <button
            onClick={() => {
              copyText(cfSshConfig as string)
            }}
            style={vsCodePanelCopyBtnStyle}
            type="button"
          >
            copy
          </button>

          <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>
            Connect via SSH
          </div>
          <code style={vsCodePanelCodeStyle}>{cfSshCommand}</code>
          <button
            onClick={() => {
              copyText(cfSshCommand as string)
            }}
            style={vsCodePanelCopyBtnStyle}
            type="button"
          >
            copy
          </button>

          <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>SSH password</div>
          <code style={vsCodePanelCodeStyle}>{cfState.sshPassword}</code>
          <button
            onClick={() => {
              copyText(cfState.sshPassword)
            }}
            style={vsCodePanelCopyBtnStyle}
            type="button"
          >
            copy
          </button>

          {cfVscodeUri !== null && (
            <>
              <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>
                Open in VS Code
              </div>
              <div style={{ marginTop: "4px" }}>
                <a
                  href={cfVscodeUri}
                  style={{
                    color: "#56f39a",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    fontWeight: "bold",
                    textDecoration: "none"
                  }}
                >
                  open in VS Code (CF tunnel)
                </a>
              </div>
            </>
          )}
        </>
      )}

      <div style={{ borderTop: "1px solid #2a4060", margin: "14px 0 10px" }} />
      <div style={{ color: "#8be9fd", fontWeight: "bold", marginBottom: "8px" }}>Direct SSH (local network)</div>

      <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold" }}>Add to ~/.ssh/config</div>
      <div style={{ color: "#8fa6c4", fontSize: "0.78em" }}>no cloudflared needed — works on same LAN</div>
      <code style={vsCodePanelCodeStyle}>{directConfig}</code>
      <button
        onClick={() => {
          copyText(directConfig)
        }}
        style={vsCodePanelCopyBtnStyle}
        type="button"
      >
        copy
      </button>

      <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>Connect via SSH</div>
      <code style={vsCodePanelCodeStyle}>{directCommand}</code>
      <button
        onClick={() => {
          copyText(directCommand)
        }}
        style={vsCodePanelCopyBtnStyle}
        type="button"
      >
        copy
      </button>

      {cfState.tag === "ready" && (
        <>
          <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>SSH password</div>
          <code style={vsCodePanelCodeStyle}>{cfState.sshPassword}</code>
          <button
            onClick={() => {
              copyText(cfState.sshPassword)
            }}
            style={vsCodePanelCopyBtnStyle}
            type="button"
          >
            copy
          </button>
        </>
      )}

      <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>Open in VS Code</div>
      <div style={{ color: "#8fa6c4", fontSize: "0.78em" }}>requires config entry above in ~/.ssh/config</div>
      <div style={{ marginTop: "4px" }}>
        <a
          href={directVscodeUri}
          style={{
            color: "#56f39a",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
            fontWeight: "bold",
            textDecoration: "none"
          }}
        >
          open in VS Code (direct)
        </a>
      </div>
    </div>
  )
}

const openBrowserAction = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): (() => void) | undefined => {
  const projectId = runtime.browserProjectId
  return projectId === undefined || !runtime.canOpenBrowser
    ? undefined
    : () => {
      props.onOpenProjectBrowserById(projectId)
    }
}

const applyProjectAction = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): (() => void) | undefined => {
  const projectId = runtime.browserProjectId
  return projectId === undefined
    ? undefined
    : () => {
      props.onApplyProjectById(projectId)
    }
}

const openTaskManagerAction = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): (() => void) | undefined => {
  const projectId = runtime.browserProjectId
  return projectId === undefined
    ? undefined
    : () => {
      props.onOpenProjectTaskManagerById(projectId)
    }
}

const openTerminalAction = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): (() => void) | undefined => {
  const projectId = runtime.browserProjectId
  return projectId === undefined
    ? undefined
    : () => {
      props.onOpenProjectTerminalById(projectId, runtime.browserProjectKey)
    }
}

const TerminalPanelForPane = (
  {
    bodyContent,
    onOpenVsCode,
    props,
    runtime
  }: {
    readonly bodyContent: JSX.Element | undefined
    readonly onOpenVsCode: (() => void) | undefined
    readonly props: TerminalPaneProps
    readonly runtime: TerminalPaneRuntime
  }
): JSX.Element => (
  <TerminalPanel
    bodyContent={bodyContent}
    keyboardOpen={props.viewportLayout.keyboardOpen}
    mobileMode={props.viewportLayout.mode === "mobile"}
    onAttachFailure={() => {
      detachTerminalSession(props, runtime)
    }}
    onDetach={() => {
      detachTerminalSession(props, runtime)
      props.onTerminalMessage(
        `${runtime.pendingSession ? "Closed pending" : "Detached"} SSH terminal: ${props.terminalSession.session.id}.`
      )
    }}
    onExit={(exitInfo) => {
      handleTerminalExit(props, runtime, exitInfo)
    }}
    onKill={() => {
      handleTerminalKill(props, runtime)
    }}
    onOpenBrowser={openBrowserAction(props, runtime)}
    onOpenSkiller={projectSkillerAction(
      runtime.browserProjectKey,
      props.terminalSession.session.id,
      props.onOpenSkiller
    )}
    onApplyProject={applyProjectAction(props, runtime)}
    onOpenTaskManager={openTaskManagerAction(props, runtime)}
    onOpenTerminal={openTerminalAction(props, runtime)}
    onMessage={props.onTerminalMessage}
    onOpenVsCode={onOpenVsCode}
    session={props.terminalSession}
  />
)

const startTunnel = (
  projectKey: string,
  setCfState: (s: CfTunnelState) => void
): void => {
  setCfState({ tag: "loading" })
  void Effect.runPromise(
    startProjectSshTunnel(projectKey).pipe(
      Effect.match({
        onFailure: () => {
          setCfState({ tag: "failed" })
        },
        onSuccess: ({ hostname, sshPassword }) => {
          setCfState(
            hostname === null
              ? { tag: "failed" }
              : { tag: "ready", hostname, sshPassword }
          )
        }
      })
    )
  )
}

export const TerminalPane = (props: TerminalPaneProps): JSX.Element => {
  const [isVsCodePanelOpen, setVsCodePanelOpen] = useState(false)
  const [cfState, setCfState] = useState<CfTunnelState>({ tag: "idle" })
  const runtime = resolveTerminalPaneRuntime(props)

  useEffect(() => {
    if (!isVsCodePanelOpen || runtime.browserProjectKey === undefined) return
    if (cfState.tag === "idle") {
      startTunnel(runtime.browserProjectKey, setCfState)
    }
  }, [isVsCodePanelOpen, runtime.browserProjectKey, cfState.tag])

  // Poll every 30s when panel is open: restart tunnel if process died
  useEffect(() => {
    if (!isVsCodePanelOpen || cfState.tag !== "ready" || runtime.browserProjectKey === undefined) return
    const projectKey = runtime.browserProjectKey
    let isCancelled = false
    const id = setInterval(() => {
      void Effect.runPromise(
        startProjectSshTunnel(projectKey).pipe(
          Effect.match({
            onFailure: () => {
              if (!isCancelled) setCfState({ tag: "failed" })
            },
            onSuccess: ({ hostname, sshPassword }) => {
              if (isCancelled) return
              if (hostname === null) {
                setCfState({ tag: "failed" })
                return
              }
              setCfState({ tag: "ready", hostname, sshPassword })
            }
          })
        )
      )
    }, 30_000)
    return () => {
      isCancelled = true
      clearInterval(id)
    }
  }, [isVsCodePanelOpen, cfState.tag, runtime.browserProjectKey])

  const vsCodeInfo = buildVsCodeAccessInfo(props.project)
  const onOpenVsCode = vsCodeInfo === null ? undefined : () => {
    setVsCodePanelOpen(true)
  }
  const vsCodeBodyContent = isVsCodePanelOpen && vsCodeInfo !== null
    ? (
      <VsCodeAccessPanel
        cfState={cfState}
        info={vsCodeInfo}
        onClose={() => {
          setVsCodePanelOpen(false)
        }}
        onRefresh={() => {
          if (runtime.browserProjectKey !== undefined) {
            startTunnel(runtime.browserProjectKey, setCfState)
          }
        }}
        onRetry={() => {
          if (runtime.browserProjectKey !== undefined) {
            startTunnel(runtime.browserProjectKey, setCfState)
          }
        }}
      />
    )
    : undefined
  const bodyContent = vsCodeBodyContent ?? terminalBodyContent(props, runtime)
  return (
    <div style={activeTerminalPaneStyle}>
      <TerminalPanelForPane bodyContent={bodyContent} onOpenVsCode={onOpenVsCode} props={props} runtime={runtime} />
    </div>
  )
}
