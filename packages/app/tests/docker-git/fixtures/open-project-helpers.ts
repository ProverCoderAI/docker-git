import { Effect } from "effect"

import type { ApiProjectDetails } from "../../../src/docker-git/api-project-codec.js"
import { selectOpenProject } from "../../../src/docker-git/open-project.js"

const defaultProject = {
  id: "/controller/org/repo",
  displayName: "org/repo",
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  status: "stopped",
  statusLabel: "stopped",
  containerName: "dg-repo",
  serviceName: "dg-repo",
  sshUser: "dev",
  sshPort: 2222,
  targetDir: "/home/dev/workspaces/org/repo",
  projectDir: "/controller/org/repo",
  sshCommand: "ssh dev@127.0.0.1 -p 2222",
  authorizedKeysPath: "/controller/org/repo/authorized_keys",
  authorizedKeysExists: true,
  envGlobalPath: "/controller/.orch/env/global.env",
  envProjectPath: "/controller/org/repo/.orch/env/project.env",
  codexAuthPath: "/controller/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null
} satisfies Omit<ApiProjectDetails, "clonedOnHostname">

export const makeProject = (overrides: Partial<ApiProjectDetails> = {}): ApiProjectDetails => ({
  ...defaultProject,
  ...overrides
})

export const joinIp = (...octets: ReadonlyArray<number>): string => octets.join(".")

export const liveRuntimeIp = joinIp(172, 17, 0, 15)
export const liveFallbackIp = joinIp(172, 17, 0, 20)

export const expectSelectedProject = (
  project: ApiProjectDetails,
  selector: string | undefined,
  assert: (resolved: ApiProjectDetails) => void
) =>
  Effect.gen(function*(_) {
    const resolved = yield* _(selectOpenProject([project], selector))
    assert(resolved)
  })
