"use client"

import { Either } from "effect"
import * as Schema from "effect/Schema"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import "xterm/css/xterm.css"

import type {
  ProcessInfo,
  ProjectDetails,
  ProjectProcessSnapshot,
  ProjectSummary,
  TerminalSession,
  TtySession
} from "../lib/api-types"
import { ApiSchema } from "../lib/api-schema"
import type { Terminal } from "xterm"
import type { FitAddon } from "xterm-addon-fit"

const encodeProjectId = (id: string): string => encodeURIComponent(id)

const makeSessionId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type TerminalStatus = "detached" | "connecting" | "connected" | "error"

type TerminalMode = "default" | "recreate"

type TerminalMessage =
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "error"; readonly data: string }
  | { readonly type: "info"; readonly data: string }

type TerminalCommand =
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }

const decodeProjectList = (payload: unknown): ReadonlyArray<ProjectSummary> =>
  Either.match(Schema.decodeUnknownEither(ApiSchema.ProjectListResponse)(payload), {
    onLeft: () => [],
    onRight: (decoded) => {
      if ("error" in decoded) {
        return []
      }
      return decoded.projects
    }
  })

const decodeProjectDetails = (payload: unknown): ProjectDetails | null =>
  Either.match(Schema.decodeUnknownEither(ApiSchema.ProjectDetails)(payload), {
    onLeft: () => null,
    onRight: (decoded) => {
      if ("error" in decoded) {
        return null
      }
      return decoded
    }
  })

const decodeTerminalSessions = (payload: unknown): ReadonlyArray<TerminalSession> =>
  Either.match(Schema.decodeUnknownEither(ApiSchema.TerminalSessions)(payload), {
    onLeft: () => [],
    onRight: (decoded) => {
      if ("error" in decoded) {
        return []
      }
      return decoded.sessions
    }
  })

const decodeProcessSnapshot = (payload: unknown): ProjectProcessSnapshot | null =>
  Either.match(Schema.decodeUnknownEither(ApiSchema.ProjectProcessSnapshot)(payload), {
    onLeft: () => null,
    onRight: (decoded) => {
      if ("error" in decoded) {
        return null
      }
      return decoded
    }
  })

const parsePort = (payload: unknown): number | null => {
  if (!payload || typeof payload !== "object") {
    return null
  }
  const port = Reflect.get(payload, "port")
  return typeof port === "number" ? port : null
}

const buildWsUrl = (
  projectId: string,
  port: number,
  sessionId: string,
  mode: TerminalMode,
  action?: "close"
): string => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws"
  const host = window.location.hostname
  const portSegment = port > 0 ? `:${port}` : ""
  const base = `${protocol}://${host}${portSegment}/terminal?projectId=${encodeProjectId(projectId)}&sessionId=${sessionId}&source=web&mode=${mode}`
  return action ? `${base}&action=${encodeURIComponent(action)}` : base
}

const sendWs = (socket: WebSocket, payload: TerminalCommand) => {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(JSON.stringify(payload))
}

type TerminalBundle = {
  readonly Terminal: typeof import("xterm").Terminal
  readonly FitAddon: typeof import("xterm-addon-fit").FitAddon
}

let terminalBundlePromise: Promise<TerminalBundle> | null = null

const loadTerminalBundle = (): Promise<TerminalBundle> => {
  if (!terminalBundlePromise) {
    terminalBundlePromise = Promise.all([import("xterm"), import("xterm-addon-fit")]).then(
      ([xterm, fit]) => ({ Terminal: xterm.Terminal, FitAddon: fit.FitAddon })
    )
  }
  return terminalBundlePromise
}

const createTerminal = (container: HTMLDivElement) =>
  loadTerminalBundle().then(({ Terminal: TerminalCtor, FitAddon: FitAddonCtor }) => {
    const terminal = new TerminalCtor({
      fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#06090e",
        foreground: "#cfe6ff",
        cursor: "#3ef0b8",
        selection: "rgba(62, 240, 184, 0.25)"
      },
      scrollback: 4000,
      convertEol: true
    })
    const fitAddon = new FitAddonCtor()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()
    terminal.focus()
    return { terminal, fitAddon }
  })

const formatSessionLine = (session: TtySession): string =>
  `${session.user} ${session.tty} ${session.date} ${session.time} idle=${session.idle} pid=${session.pid} (${session.host})`

const formatProcessLine = (process: ProcessInfo): string =>
  `${process.tty} ${process.pid} ${process.start} ${process.command}`

const statusBadgeClass = (status: string): string => {
  if (status === "running") {
    return "badge"
  }
  if (status === "stopped") {
    return "badge danger"
  }
  return "badge warn"
}

const terminalBadgeClass = (status: TerminalStatus): string => {
  if (status === "connected") {
    return "badge"
  }
  if (status === "connecting") {
    return "badge warn"
  }
  if (status === "error") {
    return "badge danger"
  }
  return "badge"
}

export default function Home() {
  const [projects, setProjects] = useState<ReadonlyArray<ProjectSummary>>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeProject, setActiveProject] = useState<ProjectDetails | null>(null)
  const [processSnapshot, setProcessSnapshot] = useState<ProjectProcessSnapshot | null>(null)
  const [terminalSessions, setTerminalSessions] = useState<ReadonlyArray<TerminalSession>>([])
  const [terminalPort, setTerminalPort] = useState<number>(3001)
  const [filter, setFilter] = useState("")
  const [attached, setAttached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>("detached")
  const [showDetails, setShowDetails] = useState(false)

  const [activeSessionId, setActiveSessionId] = useState(makeSessionId)
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeHandlerRef = useRef<(() => void) | null>(null)

  const filteredProjects = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) {
      return projects
    }
    return projects.filter((project) =>
      project.displayName.toLowerCase().includes(needle) ||
      project.repoUrl.toLowerCase().includes(needle)
    )
  }, [filter, projects])

  const refreshProjects = useCallback(() => {
    fetch("/api/projects")
      .then((response) => response.json())
      .then((payload: unknown) => {
        const decoded = decodeProjectList(payload)
        setProjects(decoded)
        const first = decoded[0]?.id
        if (first) {
          setActiveId((current) => current ?? first)
        }
      })
      .catch(() => setProjects([]))
  }, [])

  const refreshActiveProject = useCallback((projectId: string) => {
    fetch(`/api/projects/${encodeProjectId(projectId)}`)
      .then((response) => response.json())
      .then((payload: unknown) => {
        setActiveProject(decodeProjectDetails(payload))
      })
      .catch(() => setActiveProject(null))
  }, [])

  // CHANGE: poll process snapshots for UI visibility
  // WHY: surface SSH TTY and background dev processes in the control room
  // QUOTE(ТЗ): "Мне надо иметь возможность это видеть"
  // REF: user-request-2026-02-04-process-visibility
  // SOURCE: n/a
  // FORMAT THEOREM: ∀p: snapshot(p) → visible(p)
  // PURITY: SHELL
  // EFFECT: Effect<ProjectProcessSnapshot | null, never, never>
  // INVARIANT: decoded snapshot matches schema
  // COMPLEXITY: O(1)
  const refreshProcessSnapshot = useCallback((projectId: string) => {
    fetch(`/api/projects/${encodeProjectId(projectId)}/processes`)
      .then((response) => response.json())
      .then((payload: unknown) => {
        setProcessSnapshot(decodeProcessSnapshot(payload))
      })
      .catch(() => setProcessSnapshot(null))
  }, [])

  const refreshTerminalSessions = useCallback(() => {
    fetch("/api/terminal-sessions")
      .then((response) => response.json())
      .then((payload: unknown) => {
        setTerminalSessions(decodeTerminalSessions(payload))
      })
      .catch(() => setTerminalSessions([]))
  }, [])

  const refreshTerminalConfig = useCallback(() => {
    fetch("/api/terminal-config")
      .then((response) => response.json())
      .then((payload: unknown) => {
        const port = parsePort(payload)
        setTerminalPort(port ?? 3001)
      })
      .catch(() => setTerminalPort(3001))
  }, [])

  const disposeTerminal = useCallback(() => {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null

    if (resizeHandlerRef.current) {
      window.removeEventListener("resize", resizeHandlerRef.current)
      resizeHandlerRef.current = null
    }

    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }

    if (terminalRef.current) {
      terminalRef.current.dispose()
      terminalRef.current = null
    }

    fitAddonRef.current = null
  }, [])

  // CHANGE: attach the live WS terminal to the selected project
  // WHY: show real SSH sessions for visibility and control
  // QUOTE(ТЗ): "мы можем получать список всех запущенных терминалов?"
  // REF: user-request-2026-02-04-terminal-sessions
  // SOURCE: n/a
  // FORMAT THEOREM: ∀t: connect(t) → visible(t)
  // PURITY: SHELL
  // EFFECT: Effect<void, never, never>
  // INVARIANT: WebSocket is closed on detach
  // COMPLEXITY: O(1)
  const connectTerminal = useCallback(
    (projectId: string, mode: TerminalMode, sessionId: string) => {
      const container = terminalContainerRef.current
      if (!container) {
        return
      }

      disposeTerminal()
      void createTerminal(container).then(({ terminal, fitAddon }) => {
        terminalRef.current = terminal
        fitAddonRef.current = fitAddon

        const socket = new WebSocket(
          buildWsUrl(projectId, terminalPort, sessionId, mode)
        )
        socketRef.current = socket

        const handleResize = () => {
          const currentFit = fitAddonRef.current
          const currentTerminal = terminalRef.current
          if (!currentFit || !currentTerminal || !socketRef.current) {
            return
          }
          currentFit.fit()
          sendWs(socketRef.current, {
            type: "resize",
            cols: currentTerminal.cols,
            rows: currentTerminal.rows
          })
        }

        resizeHandlerRef.current = handleResize
        window.addEventListener("resize", handleResize)
        resizeObserverRef.current = new ResizeObserver(handleResize)
        resizeObserverRef.current.observe(container)

        terminal.onData((data) => {
          if (!socketRef.current) {
            return
          }
          sendWs(socketRef.current, { type: "input", data })
        })

        socket.onopen = () => {
          setTerminalStatus("connected")
          handleResize()
        }

        socket.onmessage = (event) => {
          const raw = typeof event.data === "string" ? event.data : ""
          if (!raw) {
            return
          }
          try {
            const parsed = JSON.parse(raw) as TerminalMessage
            if (parsed.type === "output") {
              terminal.write(parsed.data)
            } else if (parsed.type === "error") {
              terminal.write(`\r\n[error] ${parsed.data}\r\n`)
            } else if (parsed.type === "info") {
              terminal.write(`\r\n${parsed.data}\r\n`)
            }
          } catch {
            terminal.write(raw)
          }
        }

        socket.onerror = () => {
          setTerminalStatus("error")
          terminal.write("\r\n[terminal error]\r\n")
        }

        socket.onclose = () => {
          setTerminalStatus("detached")
          setAttached(false)
          terminal.write("\r\n[disconnected]\r\n")
        }
      })
    },
    [disposeTerminal, terminalPort]
  )

  const runAttach = useCallback(() => {
    if (!activeId) {
      return
    }
    setLoading(true)
    setTerminalStatus("connecting")
    fetch(`/api/projects/${encodeProjectId(activeId)}/up`, { method: "POST" })
      .then(() => {
        setAttached(true)
        connectTerminal(activeId, "default", activeSessionId)
        refreshActiveProject(activeId)
        refreshProcessSnapshot(activeId)
      })
      .finally(() => setLoading(false))
  }, [activeId, activeSessionId, connectTerminal, refreshActiveProject, refreshProcessSnapshot])

  const runRecreate = useCallback(() => {
    if (!activeId) {
      return
    }
    setLoading(true)
    setTerminalStatus("connecting")
    fetch(`/api/projects/${encodeProjectId(activeId)}/recreate`, { method: "POST" })
      .catch(() => null)
      .finally(() => {
        setAttached(true)
        connectTerminal(activeId, "recreate", activeSessionId)
        refreshActiveProject(activeId)
        refreshProcessSnapshot(activeId)
        setLoading(false)
      })
  }, [activeId, activeSessionId, connectTerminal, refreshActiveProject, refreshProcessSnapshot])

  const runDetach = useCallback(() => {
    setAttached(false)
    setTerminalStatus("detached")
    disposeTerminal()
  }, [disposeTerminal])

  const runNewTerminal = useCallback(() => {
    if (!activeId) {
      return
    }
    const nextId = makeSessionId()
    setActiveSessionId(nextId)
    setLoading(true)
    setTerminalStatus("connecting")
    fetch(`/api/projects/${encodeProjectId(activeId)}/up`, { method: "POST" })
      .then(() => {
        setAttached(true)
        connectTerminal(activeId, "default", nextId)
        refreshActiveProject(activeId)
        refreshProcessSnapshot(activeId)
      })
      .finally(() => setLoading(false))
  }, [activeId, connectTerminal, refreshActiveProject, refreshProcessSnapshot])

  const handleSessionSelect = useCallback(
    (session: TerminalSession) => {
      setActiveId(session.projectId)
      setActiveSessionId(session.id)
      setAttached(true)
      setTerminalStatus("connecting")
      connectTerminal(session.projectId, session.mode, session.id)
      refreshActiveProject(session.projectId)
      refreshProcessSnapshot(session.projectId)
    },
    [connectTerminal, refreshActiveProject, refreshProcessSnapshot]
  )

  const handleSessionClose = useCallback(
    (session: TerminalSession) => {
      if (session.id === activeSessionId) {
        runDetach()
      }
      const socket = new WebSocket(
        buildWsUrl(session.projectId, terminalPort, session.id, session.mode, "close")
      )
      socket.onopen = () => socket.close()
      socket.onerror = () => socket.close()
    },
    [activeSessionId, runDetach, terminalPort]
  )

  const handleProjectClick = useCallback(
    (projectId: string) => {
      setActiveId(projectId)
      setActiveSessionId(makeSessionId())
      setAttached(false)
      setTerminalStatus("detached")
      disposeTerminal()
    },
    [disposeTerminal]
  )

  const handlePortOpen = useCallback(
    (port: number) => {
      if (port === 22) {
        return
      }
      const host = activeProject?.ip && activeProject.ip.length > 0
        ? activeProject.ip
        : "localhost"
      window.open(`http://${host}:${port}`, "_blank", "noopener")
    },
    [activeProject]
  )

  const toggleDetails = useCallback(() => {
    setShowDetails((current) => !current)
  }, [])

  useEffect(() => {
    refreshProjects()
    refreshTerminalConfig()
    refreshTerminalSessions()
  }, [refreshProjects, refreshTerminalConfig, refreshTerminalSessions])

  useEffect(() => {
    if (!activeId) {
      return
    }
    refreshActiveProject(activeId)
    refreshProcessSnapshot(activeId)
  }, [activeId, refreshActiveProject, refreshProcessSnapshot])

  useEffect(() => {
    if (!activeId) {
      return undefined
    }
    const interval = setInterval(() => {
      refreshActiveProject(activeId)
      refreshProcessSnapshot(activeId)
    }, 2000)
    return () => clearInterval(interval)
  }, [activeId, refreshActiveProject, refreshProcessSnapshot])

  useEffect(() => {
    const interval = setInterval(() => {
      refreshTerminalSessions()
    }, 2000)
    return () => clearInterval(interval)
  }, [refreshTerminalSessions])

  useEffect(() => () => disposeTerminal(), [disposeTerminal])

  const connectedLabel = activeProject?.displayName ?? "none"
  const statusLabel = activeProject?.statusLabel ?? "unknown"
  const sshLabel = activeProject?.ssh ?? "-"
  const repoLabel = activeProject?.displayName ?? "-"
  const refLabel = activeProject?.repoRef ?? "-"
  const recreateStatus = activeProject?.recreateStatus
  const recreatePhase = recreateStatus?.phase ?? "idle"
  const recreateClass = recreatePhase === "error"
    ? "pill notice error"
    : recreatePhase === "success"
      ? "pill notice success"
      : recreatePhase === "running"
        ? "pill notice"
        : "pill"

  const ttySessions = processSnapshot?.ttySessions ?? []
  const ttyProcesses = processSnapshot?.ttyProcesses ?? []
  const backgroundProcesses = processSnapshot?.backgroundProcesses ?? []

  return (
    <div className="page crm">
      <header className="app-header">
        <div className="brand">docker-git</div>
        <div className="status-chip">
          <span className="status-dot" />
          Connected · {connectedLabel}
        </div>
      </header>

      <section className="shell">
        <div className="crm-layout">
          <aside className="crm-sidebar">
            <div className="panel-header">
              <span className="panel-title">Projects</span>
              <span className="badge">{projects.length}</span>
            </div>
            <input
              className="input"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter projects"
            />
            <div className="list projects-list">
              {filteredProjects.length === 0 ? (
                <div className="empty-state">No projects yet</div>
              ) : (
                filteredProjects.map((project) => (
                  <button
                    key={project.id}
                    className={`list-item ${project.id === activeId ? "active" : ""}`}
                    onClick={() => handleProjectClick(project.id)}
                    type="button"
                  >
                    <div className="list-item-row">
                      <strong>{project.displayName}</strong>
                      <span className={statusBadgeClass(project.status)}>{project.status}</span>
                    </div>
                    <small>
                      {project.repoRef} · {project.statusLabel}
                    </small>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="crm-main">
            <div className="topbar">
              <div className="topbar-meta">
                <span className="pill">SSH: {sshLabel}</span>
                <span className="pill">Repo: {repoLabel}</span>
                <span className="pill">Ref: {refLabel}</span>
                <span className="pill">Status: {statusLabel}</span>
                <span className={recreateClass}>Recreate: {recreatePhase}</span>
                <span className="pill">Terminal: {terminalStatus}</span>
                <span className="pill">WS port: {terminalPort}</span>
              </div>
              <div className="topbar-actions">
                <button
                  className="button"
                  onClick={runAttach}
                  disabled={!activeId || loading}
                  type="button"
                >
                  Attach
                </button>
                <button
                  className="button secondary"
                  onClick={runDetach}
                  disabled={!attached}
                  type="button"
                >
                  Detach
                </button>
                <button
                  className="button secondary"
                  onClick={runRecreate}
                  disabled={!activeId || loading}
                  type="button"
                >
                  Force Recreate
                </button>
              </div>
            </div>

            <div className="terminal-pane">
              <div className="terminal-view">
                <div className="panel-header">
                  <span className="panel-title">Live terminal</span>
                  <span className={terminalBadgeClass(terminalStatus)}>{terminalStatus}</span>
                </div>
                <div
                  className={`terminal-shell ${attached ? "active" : ""}`}
                  ref={terminalContainerRef}
                >
                  {!attached && (
                    <div className="terminal-placeholder">
                      Attach to open a live SSH terminal for the selected project.
                    </div>
                  )}
                </div>
              </div>

              <div className="panel-side">
                <div className="panel-section">
                <div className="panel-header">
                  <span className="panel-title">Terminals</span>
                  <div className="panel-header-actions">
                    <span className="badge">{terminalSessions.length}</span>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={runNewTerminal}
                    >
                      New
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={toggleDetails}
                    >
                      {showDetails ? "Hide details" : "Show details"}
                    </button>
                  </div>
                </div>
                <div className="terminal-tabs">
                  <div className="terminal-list">
                    {terminalSessions.length === 0 ? (
                      <div className="empty-state">
                        {showDetails ? "No active terminals" : "None"}
                      </div>
                    ) : (
                      terminalSessions.map((session) => (
                        <div
                          key={session.id}
                          className={`list-item ${session.id === activeSessionId ? "active" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSessionSelect(session)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              handleSessionSelect(session)
                            }
                          }}
                        >
                          <div className="list-item-row">
                            <strong>{session.displayName}</strong>
                            <div className="list-item-actions">
                              <span className={session.status === "connected" ? "badge" : "badge warn"}>
                                {session.status}
                              </span>
                              <button
                                className="icon-button"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleSessionClose(session)
                                }}
                              >
                                delete
                              </button>
                            </div>
                          </div>
                          <small>
                            {session.source} · {session.mode} · {session.projectId}
                          </small>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

                {showDetails && (
                  <div className="panel-section">
                    <div className="panel-header">
                      <span className="panel-title">SSH sessions (who -u)</span>
                      <span className="badge">{ttySessions.length}</span>
                    </div>
                    <div className="terminal-log">
                      {ttySessions.length === 0 ? (
                        <div className="terminal-line muted">No SSH TTY sessions</div>
                      ) : (
                        ttySessions.map((session) => (
                          <div key={`${session.tty}-${session.pid}`} className="terminal-line">
                            {formatSessionLine(session)}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {showDetails && (
                  <div className="panel-section">
                    <div className="panel-header">
                      <span className="panel-title">TTY processes</span>
                      <span className="badge">{ttyProcesses.length}</span>
                    </div>
                    <div className="terminal-log">
                      {ttyProcesses.length === 0 ? (
                        <div className="terminal-line muted">No TTY-bound processes</div>
                      ) : (
                        ttyProcesses.map((process) => (
                          <div key={`${process.tty}-${process.pid}`} className="terminal-line">
                            {formatProcessLine(process)}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {showDetails && (
                  <div className="panel-section">
                    <div className="panel-header">
                      <span className="panel-title">Background dev processes</span>
                      <span className="badge">{backgroundProcesses.length}</span>
                    </div>
                    <div className="terminal-log">
                      {backgroundProcesses.length === 0 ? (
                        <div className="terminal-line muted">No background dev processes</div>
                      ) : (
                        backgroundProcesses.map((process) => (
                          <div key={`bg-${process.pid}`} className="terminal-line">
                            {`${process.pid} ${process.start} ${process.command}`}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div className="panel-section">
                  <div className="panel-header">
                    <span className="panel-title">Ports</span>
                    <span className="badge">{activeProject?.ports?.length ?? 0}</span>
                  </div>
                  <div className="terminal-tabs">
                    <div className="terminal-list">
                      {(activeProject?.ports ?? []).length === 0 ? (
                        <div className="empty-state">No ports published</div>
                      ) : (
                        (activeProject?.ports ?? []).map((port) => (
                          <div key={port.port} className="list-item">
                            <div className="list-item-row">
                              <strong>:{port.port}</strong>
                              <button
                                className="icon-button"
                                type="button"
                                onClick={() => handlePortOpen(port.port)}
                              >
                                open
                              </button>
                            </div>
                            <small>{port.label}</small>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {showDetails && (
                  <div className="panel-section">
                    <div className="panel-header">
                      <span className="panel-title">Jobs</span>
                      <span className="badge">{activeProject?.jobs?.length ?? 0}</span>
                    </div>
                    <div className="terminal-tabs">
                      <div className="terminal-list">
                        {(activeProject?.jobs ?? []).length === 0 ? (
                          <div className="empty-state">No jobs running</div>
                        ) : (
                          (activeProject?.jobs ?? []).map((job) => (
                            <div key={job.pid} className="job-row">
                              <div>
                                <strong>{job.cmd}</strong>
                                <div>
                                  <small>PID {job.pid}</small>
                                </div>
                              </div>
                              <div>
                                <small>{job.elapsed}</small>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {showDetails && (
                  <div className="panel-section">
                    <div className="panel-header">
                      <span className="panel-title">Recent logs</span>
                      <span className="badge">{activeProject?.logs?.length ?? 0}</span>
                    </div>
                    <div className="terminal-log">
                      {(activeProject?.logs ?? []).length === 0 ? (
                        <div className="terminal-line muted">No log lines yet</div>
                      ) : (
                        (activeProject?.logs ?? []).map((line, index) => (
                          <div key={`${index}-${line}`} className="terminal-line muted">
                            {line}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
