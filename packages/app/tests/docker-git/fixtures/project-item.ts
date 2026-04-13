import type { ProjectItem } from "../../../src/docker-git/project-item.js"

export const makeProjectItem = (
  overrides: Partial<ProjectItem> = {}
): ProjectItem => ({
  id: "/home/dev/.docker-git/org-repo",
  projectDir: "/home/dev/.docker-git/org-repo",
  displayName: "org/repo",
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  containerName: "dg-repo",
  serviceName: "dg-repo",
  sshUser: "dev",
  sshPort: 2222,
  targetDir: "/home/dev/org/repo",
  sshCommand: "ssh -p 2222 dev@localhost",
  authorizedKeysPath: "/home/dev/.docker-git/org-repo/authorized_keys",
  authorizedKeysExists: true,
  envGlobalPath: "/home/dev/.docker-git/org-repo/.orch/env/global.env",
  envProjectPath: "/home/dev/.docker-git/org-repo/.orch/env/project.env",
  codexAuthPath: "/home/dev/.docker-git/org-repo/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  status: "stopped",
  statusLabel: "Stopped",
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null,
  ...overrides
})
