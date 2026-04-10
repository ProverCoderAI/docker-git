import type { ApiProjectDetails } from "./api-project-codec.js"

export type ProjectItem = {
  readonly projectDir: string
  readonly displayName: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly targetDir: string
  readonly sshCommand: string
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
  readonly status: "running" | "stopped" | "unknown"
  readonly statusLabel: string
  readonly sshSessions: number
  readonly startedAtIso: string | null
  readonly startedAtEpochMs: number | null
  readonly clonedOnHostname?: string | undefined
}

export const projectItemFromApiDetails = (project: ApiProjectDetails): ProjectItem => ({
  projectDir: project.projectDir,
  displayName: project.displayName,
  repoUrl: project.repoUrl,
  repoRef: project.repoRef,
  containerName: project.containerName,
  serviceName: project.serviceName,
  sshUser: project.sshUser,
  sshPort: project.sshPort,
  targetDir: project.targetDir,
  sshCommand: project.sshCommand,
  authorizedKeysPath: project.authorizedKeysPath,
  authorizedKeysExists: project.authorizedKeysExists,
  envGlobalPath: project.envGlobalPath,
  envProjectPath: project.envProjectPath,
  codexAuthPath: project.codexAuthPath,
  codexHome: project.codexHome,
  status: project.status,
  statusLabel: project.statusLabel,
  sshSessions: project.sshSessions,
  startedAtIso: project.startedAtIso,
  startedAtEpochMs: project.startedAtEpochMs,
  clonedOnHostname: project.clonedOnHostname
})

export const resolveApiProjectItem = (project: ApiProjectDetails): ProjectItem => projectItemFromApiDetails(project)
