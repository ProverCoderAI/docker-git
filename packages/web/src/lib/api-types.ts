export type ProjectStatus = "running" | "stopped" | "unknown"

export type RecreatePhase = "idle" | "running" | "success" | "error"

export type RecreateStatus = {
  readonly phase: RecreatePhase
  readonly message: string
  readonly updatedAt: string
}

export type ProjectSummary = {
  readonly id: string
  readonly displayName: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly status: ProjectStatus
  readonly statusLabel: string
}

export type PortInfo = {
  readonly port: number
  readonly label: string
}

export type JobInfo = {
  readonly pid: number
  readonly tty: string
  readonly cmd: string
  readonly elapsed: string
}

export type ProjectDetails = {
  readonly id: string
  readonly displayName: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly status: ProjectStatus
  readonly statusLabel: string
  readonly recreateStatus?: RecreateStatus
  readonly ssh: string
  readonly sshCommand: string
  readonly projectDir: string
  readonly containerName: string
  readonly serviceName: string
  readonly targetDir: string
  readonly ip: string
  readonly ports: ReadonlyArray<PortInfo>
  readonly jobs: ReadonlyArray<JobInfo>
  readonly logs: ReadonlyArray<string>
}

export type ExecResponse = {
  readonly output: string
}

export type ApiError = {
  readonly error: string
}

export type TerminalSessionStatus = "connecting" | "connected" | "detached"

export type TerminalSessionMode = "default" | "recreate"

export type TerminalSession = {
  readonly id: string
  readonly projectId: string
  readonly displayName: string
  readonly containerName?: string
  readonly mode: TerminalSessionMode
  readonly source: string
  readonly status: TerminalSessionStatus
  readonly connectedAt: string
  readonly updatedAt: string
}

export type TerminalSessionsResponse = {
  readonly sessions: ReadonlyArray<TerminalSession>
}

export type TtySession = {
  readonly user: string
  readonly tty: string
  readonly date: string
  readonly time: string
  readonly idle: string
  readonly pid: number
  readonly host: string
}

export type ProcessInfo = {
  readonly pid: number
  readonly ppid: number
  readonly tty: string
  readonly stat: string
  readonly start: string
  readonly command: string
}

export type ProjectProcessSnapshot = {
  readonly capturedAt: string
  readonly ttySessions: ReadonlyArray<TtySession>
  readonly ttyProcesses: ReadonlyArray<ProcessInfo>
  readonly backgroundProcesses: ReadonlyArray<ProcessInfo>
}
