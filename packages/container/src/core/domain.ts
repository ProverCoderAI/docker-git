// CHANGE: own the container-definition domain (TemplateConfig and derived naming) in the container package
// WHY: container definition (Dockerfile/entrypoint/compose rendering) must be a self-contained leaf package
//      that the backend depends on, without depending back on backend/CLI/menu domain.
// QUOTE(ТЗ): "Логика контейнеров должна лежать в отдельном сабмодуле, а сама панель это отдельный модуль"
// REF: issue-412
// PURITY: CORE
// INVARIANT: this module never imports shell/usecases/api/app or non-container domain (auth/menu/sessions/state)
// COMPLEXITY: O(1)

export {
  defaultCpuLimit,
  defaultDockerNetworkMode,
  defaultDockerSharedNetworkName,
  defaultPlaywrightCpuLimit,
  defaultPlaywrightRamLimit,
  defaultRamLimit,
  defaultTemplateConfig,
  dockerGitSharedCacheVolumeName,
  dockerGitSharedCodexVolumeName
} from "./template-defaults.js"

export type AgentMode = "claude" | "codex" | "gemini" | "grok"

export type DockerNetworkMode = "shared" | "project"
export type GpuMode = "none" | "all"

const unixUsernamePattern = /^[a-z_][a-z0-9_-]{0,31}$/

export const sshUsernamePatternDescription = "^[a-z_][a-z0-9_-]{0,31}$"

// CHANGE: define the SSH user name invariant in the core domain
// WHY: generated Dockerfiles and entrypoints interpolate sshUser into shell-sensitive user commands
// QUOTE(ТЗ): n/a
// REF: PR-281-coderabbit-sshUser-validation
// SOURCE: n/a
// FORMAT THEOREM: forall u: isUnixUsername(u) -> not contains_shell_metacharacters(u)
// PURITY: CORE
// INVARIANT: accepted user names contain only lowercase Linux account-name characters
// COMPLEXITY: O(n)/O(1) where n = |value|
export const isUnixUsername = (value: string): boolean => unixUsernamePattern.test(value)

export interface TemplateConfig {
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly repoUrl: string
  readonly repoRef: string
  readonly forkRepoUrl?: string
  readonly gitTokenLabel?: string | undefined
  readonly skipGithubAuth: boolean
  readonly codexAuthLabel?: string | undefined
  readonly claudeAuthLabel?: string | undefined
  readonly targetDir: string
  readonly volumeName: string
  readonly dockerGitPath: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexSharedAuthPath: string
  readonly codexHome: string
  readonly geminiAuthLabel?: string | undefined
  readonly geminiAuthPath: string
  readonly geminiHome: string
  readonly grokAuthLabel?: string | undefined
  readonly grokAuthPath: string
  readonly grokHome: string
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly playwrightCpuLimit?: string | undefined
  readonly playwrightRamLimit?: string | undefined
  readonly gpu: GpuMode
  readonly dockerNetworkMode: DockerNetworkMode
  readonly dockerSharedNetworkName: string
  readonly enableMcpPlaywright: boolean
  readonly bunVersion: string
  readonly agentMode?: AgentMode | undefined
  readonly agentAuto?: boolean | undefined
  readonly clonedOnHostname?: string | undefined
}

export interface ProjectConfig {
  readonly schemaVersion: 1
  readonly template: TemplateConfig
}

// CHANGE: validate docker network mode values at the CLI/config boundary
// WHY: keep compose network behavior explicit and type-safe
// QUOTE(ТЗ): "Что бы среды были изолированы?"
// REF: user-request-2026-02-20-networks
// SOURCE: n/a
// FORMAT THEOREM: ∀x: isDockerNetworkMode(x) -> x ∈ {"shared","project"}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returns true only for known modes
// COMPLEXITY: O(1)
export const isDockerNetworkMode = (
  value: string
): value is DockerNetworkMode => value === "shared" || value === "project"

export const isGpuMode = (value: string): value is GpuMode => value === "none" || value === "all"

// CHANGE: derive compose network name from typed template config
// WHY: keep network naming deterministic across template generation and runtime checks
// QUOTE(ТЗ): "Если я хочу уникальную сеть на каждый контейнер?"
// REF: user-request-2026-02-20-networks
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: resolveComposeNetworkName(cfg) = n -> deterministic(n)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: shared mode always resolves to dockerSharedNetworkName; project mode to "<service>-net"
// COMPLEXITY: O(1)
export const resolveComposeNetworkName = (
  config: Pick<
    TemplateConfig,
    "serviceName" | "dockerNetworkMode" | "dockerSharedNetworkName"
  >
): string =>
  config.dockerNetworkMode === "shared"
    ? config.dockerSharedNetworkName
    : `${config.serviceName}-net`

// CHANGE: derive a stable bootstrap volume name for per-project runtime bootstrap data
// WHY: API/controller mode cannot rely on host bind mounts for auth/env material
// QUOTE(ТЗ): "У нас есть CLI который вызывает docker ? ... Поднимается сервер и ты через него можешь общаться с контейнером"
// REF: user-request-2026-03-15-api-controller
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: resolveProjectBootstrapVolumeName(cfg) = v -> deterministic(v)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: bootstrap volume name is derived solely from project volumeName
// COMPLEXITY: O(1)
export const resolveProjectBootstrapVolumeName = (
  config: Pick<TemplateConfig, "volumeName">
): string => `${config.volumeName}-bootstrap`

// CHANGE: derive a stable docker compose project name from typed template config
// WHY: managed project lifecycle must not depend on the output directory basename, otherwise "docker compose down -v"
// can target an unrelated stack that happens to share the same folder name (for example the controller repo itself).
// QUOTE(ТЗ): "Весь процесс должен быть высроен так что основной бекенд крутится в docker"
// REF: user-request-2026-04-03-compose-project-isolation
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: resolveComposeProjectName(cfg) = p -> deterministic(p) ∧ isolated_compose_project(p)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: compose project identity is derived solely from serviceName, never cwd basename
// COMPLEXITY: O(1)
export const resolveComposeProjectName = (
  config: Pick<TemplateConfig, "serviceName">
): string => config.serviceName
