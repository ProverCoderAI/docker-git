import type { BrowserActionContext } from "../../src/web/actions-shared.js"
import type { ProjectDetails, StartProjectTerminalSessionAccepted, TerminalSession } from "../../src/web/api.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"

export const project: ProjectDetails = {
  authorizedKeysExists: true,
  authorizedKeysPath: "/home/dev/.docker-git/project/authorized_keys",
  clonedOnHostname: "host",
  codexAuthPath: "/home/dev/.docker-git/.orch/auth/codex",
  codexHome: "/home/dev/.docker-git/.orch/codex",
  containerName: "docker-git-project-1",
  displayName: "octocat/hello-world",
  envGlobalPath: "/home/dev/.docker-git/.orch/env/global.env",
  envProjectPath: "/home/dev/.docker-git/project/.orch/env/project.env",
  gpu: "none",
  id: "project-1",
  projectDir: "/home/dev/.docker-git/octocat/hello-world",
  projectKey: "octocat/hello-world",
  repoRef: "main",
  repoUrl: "https://github.com/octocat/Hello-World.git",
  serviceName: "app",
  sshCommand: "ssh -p 22 dev@172.18.0.7",
  sshPort: 22,
  sshSessions: 1,
  sshUser: "dev",
  startedAtEpochMs: 1_776_775_000_000,
  startedAtIso: "2026-04-21T10:00:00.000Z",
  status: "running",
  statusLabel: "Up",
  targetDir: "/home/dev/project"
}

export const session: TerminalSession = {
  createdAt: "2026-04-21T10:00:00.000Z",
  id: "session-1",
  projectId: "project-1",
  sshCommand: "ssh -p 22 dev@172.18.0.7",
  status: "ready"
}

export const startTerminalAccepted = (requestId: string): StartProjectTerminalSessionAccepted => ({
  accepted: true,
  cursor: 7,
  projectId: "project-1",
  requestId
})

export const makeSelectedProjectContext = (overrides: Partial<BrowserActionContext>) =>
  makeBrowserActionContext({
    ...overrides,
    selectedProjectId: "project-1",
    selectedProjectKey: "octocat/hello-world"
  })
