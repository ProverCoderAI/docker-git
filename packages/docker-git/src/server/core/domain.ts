export interface ProjectSummary {
  readonly id: string
  readonly directory: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly sshUser: string
  readonly sshPort: number
  readonly sshHost: string
  readonly sshCommand: string
  readonly sshKeyPath: string | null
  readonly containerName: string
  readonly serviceName: string
  readonly targetDir: string
  readonly volumeName: string
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly envGlobalPath: string
  readonly envGlobalExists: boolean
  readonly envProjectPath: string
  readonly envProjectExists: boolean
  readonly codexAuthPath: string
  readonly codexHome: string
}

export type ProjectIssue =
  | { readonly _tag: "ConfigNotFound"; readonly id: string; readonly path: string }
  | { readonly _tag: "ConfigDecode"; readonly id: string; readonly path: string; readonly message: string }

export interface ProjectsIndex {
  readonly root: string
  readonly exists: boolean
  readonly projects: ReadonlyArray<ProjectSummary>
  readonly issues: ReadonlyArray<ProjectIssue>
}

export interface SshCommandInput {
  readonly sshUser: string
  readonly sshPort: number
  readonly sshHost: string
  readonly sshKeyPath: string | null
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "")
const expandHome = (value: string, env: Record<string, string | undefined>): string => {
  const home = env["HOME"] ?? env["USERPROFILE"]
  if (!home || home.trim().length === 0) {
    return value
  }
  const trimmedHome = trimTrailingSlash(home.trim())
  if (value === "~") {
    return trimmedHome
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return `${trimmedHome}${value.slice(1)}`
  }
  return value
}

// CHANGE: resolve the projects root from environment or cwd
// WHY: keep root selection pure and consistent across CLI and API
// QUOTE(ТЗ): "оркестратор ... управляем всеми докер образами проектов"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall cwd, env: root(env, cwd) != "" 
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: returns a non-empty absolute-ish path segment
// COMPLEXITY: O(1)
export const resolveProjectsRoot = (cwd: string, env: Record<string, string | undefined>): string => {
  const explicit = env["DOCKER_GIT_PROJECTS_ROOT"]?.trim()
  if (explicit && explicit.length > 0) {
    return expandHome(explicit, env)
  }

  const home = env["HOME"] ?? env["USERPROFILE"]
  if (home && home.trim().length > 0) {
    return `${trimTrailingSlash(home.trim())}/.docker-git`
  }

  return `${cwd}/.docker-git`
}

// CHANGE: derive the shared `.orch` root from the projects root
// WHY: keep shared credentials and auth caches in the existing `.orch` layout
// QUOTE(ТЗ): "ОСТАВЬ ВСЁ В .orch"
// REF: issue-61
// SOURCE: n/a
// FORMAT THEOREM: forall root: orch(root) = root + "/.orch"
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returned path is non-empty
// COMPLEXITY: O(1)
export const resolveOrchRoot = (projectsRoot: string): string =>
  `${trimTrailingSlash(projectsRoot)}/.orch`

// Backward-compatible alias (older code/tests referenced "secrets" root).
export const resolveSecretsRoot = (projectsRoot: string): string => resolveOrchRoot(projectsRoot)

// CHANGE: derive the shared global env file path
// WHY: allow orchestrator-level integrations without entering containers
// QUOTE(ТЗ): "у меня должна быть возможность подключать гитхаб"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall root: globalEnv(root) = orch(root) + "/env/global.env"
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: returned path is non-empty
// COMPLEXITY: O(1)
export const resolveGlobalEnvPath = (projectsRoot: string): string =>
  `${resolveOrchRoot(projectsRoot)}/env/global.env`

// CHANGE: derive the shared Codex auth directory path
// WHY: allow Codex credentials to be managed globally in the orchestrator
// QUOTE(ТЗ): "Добавь подключение Codex в интеграции"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall root: codex(root) = orch(root) + "/auth/codex"
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: returned path is non-empty
// COMPLEXITY: O(1)
export const resolveCodexAuthPath = (projectsRoot: string): string =>
  `${resolveOrchRoot(projectsRoot)}/auth/codex`

// CHANGE: resolve the SSH host for connection commands
// WHY: allow users to override the hostname when SSH is bound to a specific interface
// QUOTE(ТЗ): "одной командой мог подключиться по SSH"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall env: host(env) != ""
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: non-empty hostname string
// COMPLEXITY: O(1)
export const resolveSshHost = (env: Record<string, string | undefined>): string => {
  const explicit = env["DOCKER_GIT_SSH_HOST"]?.trim()
  if (explicit && explicit.length > 0) {
    return explicit
  }

  return "localhost"
}

// CHANGE: build a deterministic SSH command for a project
// WHY: provide a single copy-paste command in the UI/API
// QUOTE(ТЗ): "Что бы я одной командой мог подключиться по SSH"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall input: command(input) is deterministic
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: command includes ssh user, host, and port
// COMPLEXITY: O(1)
export const buildSshCommand = (input: SshCommandInput): string =>
  input.sshKeyPath === null
    ? `ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${input.sshPort} ${input.sshUser}@${input.sshHost}`
    : `ssh -i ${input.sshKeyPath} -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${input.sshPort} ${input.sshUser}@${input.sshHost}`
