import { Either } from "effect"
import { hostname } from "node:os"

import { expandContainerHome } from "../usecases/scrap-path.js"
import { resolveAutoAgentFlags } from "./auto-agent-flags.js"
import { nonEmpty, parseDockerNetworkMode, parseSshPort } from "./command-builders-shared.js"
import { type RawOptions } from "./command-options.js"
import {
  type AgentMode,
  type CreateCommand,
  defaultTemplateConfig,
  deriveRepoPathParts,
  deriveRepoSlug,
  type ParseError,
  resolveRepoInput
} from "./domain.js"
import { resolveResourceLimitsIntent } from "./resource-limits.js"
import { trimRightChar } from "./strings.js"
import { normalizeAuthLabel, normalizeGitTokenLabel } from "./token-labels.js"

export { nonEmpty } from "./command-builders-shared.js"

const normalizeSecretsRoot = (value: string): string => trimRightChar(value, "/")

type RepoBasics = {
  readonly repoUrl: string
  readonly repoSlug: string
  readonly projectSlug: string
  readonly repoPath: string
  readonly repoRef: string
  readonly targetDir: string
  readonly sshUser: string
  readonly sshPort: number
}

const resolveRepoBasics = (raw: RawOptions): Either.Either<RepoBasics, ParseError> =>
  Either.gen(function*(_) {
    const rawRepoUrl = raw.repoUrl?.trim() ?? ""
    const resolvedRepo = resolveRepoInput(rawRepoUrl)
    const repoUrl = resolvedRepo.repoUrl
    const repoSlug = deriveRepoSlug(repoUrl)
    const repoPathParts = deriveRepoPathParts(repoUrl).pathParts
    const workspaceSuffix = resolvedRepo.workspaceSuffix
    const projectSlug = workspaceSuffix ? `${repoSlug}-${workspaceSuffix}` : repoSlug
    const repoPath = workspaceSuffix ? [...repoPathParts, workspaceSuffix].join("/") : repoPathParts.join("/")
    const repoRef = yield* _(
      nonEmpty("--repo-ref", raw.repoRef ?? resolvedRepo.repoRef, defaultTemplateConfig.repoRef)
    )
    const sshUser = yield* _(nonEmpty("--ssh-user", raw.sshUser, defaultTemplateConfig.sshUser))
    const rawTargetDir = yield* _(
      nonEmpty("--target-dir", raw.targetDir, defaultTemplateConfig.targetDir)
    )
    const targetDir = expandContainerHome(sshUser, rawTargetDir)
    const sshPort = yield* _(parseSshPort(raw.sshPort ?? String(defaultTemplateConfig.sshPort)))

    return { repoUrl, repoSlug, projectSlug, repoPath, repoRef, targetDir, sshUser, sshPort }
  })

type NameConfig = {
  readonly containerName: string
  readonly serviceName: string
  readonly volumeName: string
}

const resolveNames = (
  raw: RawOptions,
  projectSlug: string
): Either.Either<NameConfig, ParseError> =>
  Either.gen(function*(_) {
    const derivedContainerName = `dg-${projectSlug}`
    const derivedServiceName = `dg-${projectSlug}`
    const derivedVolumeName = `dg-${projectSlug}-home`
    const containerName = yield* _(
      nonEmpty("--container-name", raw.containerName, derivedContainerName)
    )
    const serviceName = yield* _(nonEmpty("--service-name", raw.serviceName, derivedServiceName))
    const volumeName = yield* _(nonEmpty("--volume-name", raw.volumeName, derivedVolumeName))

    return { containerName, serviceName, volumeName }
  })

type PathConfig = {
  readonly dockerGitPath: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexSharedAuthPath: string
  readonly codexHome: string
  readonly geminiAuthPath: string
  readonly geminiHome: string
  readonly outDir: string
}

type DefaultPathConfig = {
  readonly dockerGitPath: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly geminiAuthPath: string
}

const resolveNormalizedSecretsRoot = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length === 0 ? undefined : normalizeSecretsRoot(trimmed)
}

const buildDefaultPathConfig = (
  normalizedSecretsRoot: string | undefined
): DefaultPathConfig =>
  normalizedSecretsRoot === undefined
    ? {
      dockerGitPath: defaultTemplateConfig.dockerGitPath,
      authorizedKeysPath: defaultTemplateConfig.authorizedKeysPath,
      envGlobalPath: defaultTemplateConfig.envGlobalPath,
      envProjectPath: defaultTemplateConfig.envProjectPath,
      codexAuthPath: defaultTemplateConfig.codexAuthPath,
      geminiAuthPath: defaultTemplateConfig.geminiAuthPath
    }
    : {
      // NOTE: Keep docker-git root mount stable (projects root) so caches like
      // `.cache/git-mirrors` remain outside the secrets dir.
      dockerGitPath: defaultTemplateConfig.dockerGitPath,
      authorizedKeysPath: defaultTemplateConfig.authorizedKeysPath,
      envGlobalPath: `${normalizedSecretsRoot}/global.env`,
      envProjectPath: defaultTemplateConfig.envProjectPath,
      codexAuthPath: `${normalizedSecretsRoot}/codex`,
      geminiAuthPath: `${normalizedSecretsRoot}/gemini`
    }

const resolvePaths = (
  raw: RawOptions,
  repoPath: string
): Either.Either<PathConfig, ParseError> =>
  Either.gen(function*(_) {
    const normalizedSecretsRoot = resolveNormalizedSecretsRoot(raw.secretsRoot)
    const defaults = buildDefaultPathConfig(normalizedSecretsRoot)
    const dockerGitPath = defaults.dockerGitPath
    const authorizedKeysPath = yield* _(
      nonEmpty("--authorized-keys", raw.authorizedKeysPath, defaults.authorizedKeysPath)
    )
    const envGlobalPath = yield* _(nonEmpty("--env-global", raw.envGlobalPath, defaults.envGlobalPath))
    const envProjectPath = yield* _(
      nonEmpty("--env-project", raw.envProjectPath, defaults.envProjectPath)
    )
    const codexAuthPath = yield* _(
      nonEmpty("--codex-auth", raw.codexAuthPath, defaults.codexAuthPath)
    )
    const codexSharedAuthPath = codexAuthPath
    const codexHome = yield* _(nonEmpty("--codex-home", raw.codexHome, defaultTemplateConfig.codexHome))
    const geminiAuthPath = defaults.geminiAuthPath
    const geminiHome = defaultTemplateConfig.geminiHome
    const outDir = yield* _(nonEmpty("--out-dir", raw.outDir, `.docker-git/${repoPath}`))

    return {
      dockerGitPath,
      authorizedKeysPath,
      envGlobalPath,
      envProjectPath,
      codexAuthPath,
      codexSharedAuthPath,
      codexHome,
      geminiAuthPath,
      geminiHome,
      outDir
    }
  })

type CreateBehavior = {
  readonly runUp: boolean
  readonly openSsh: boolean
  readonly skipGithubAuth: boolean
  readonly force: boolean
  readonly forceEnv: boolean
  readonly enableMcpPlaywright: boolean
}

const resolveCreateBehavior = (raw: RawOptions): CreateBehavior => ({
  runUp: raw.up ?? true,
  openSsh: raw.openSsh ?? false,
  skipGithubAuth: raw.skipGithubAuth ?? false,
  force: raw.force ?? false,
  forceEnv: raw.forceEnv ?? false,
  enableMcpPlaywright: raw.enableMcpPlaywright ?? false
})

type BuildTemplateConfigInput = {
  readonly repo: RepoBasics
  readonly names: NameConfig
  readonly paths: PathConfig
  readonly cpuLimit: string | undefined
  readonly ramLimit: string | undefined
  readonly playwrightCpuLimit: string | undefined
  readonly playwrightRamLimit: string | undefined
  readonly dockerNetworkMode: CreateCommand["config"]["dockerNetworkMode"]
  readonly dockerSharedNetworkName: string
  readonly gitTokenLabel: string | undefined
  readonly skipGithubAuth: boolean
  readonly codexAuthLabel: string | undefined
  readonly claudeAuthLabel: string | undefined
  readonly enableMcpPlaywright: boolean
  readonly agentMode: AgentMode | undefined
  readonly agentAuto: boolean
  readonly clonedOnHostname: string
}

const buildTemplateConfigBase = (
  input: Pick<BuildTemplateConfigInput, "repo" | "names" | "paths">
): Pick<
  CreateCommand["config"],
  | "containerName"
  | "serviceName"
  | "sshUser"
  | "sshPort"
  | "repoUrl"
  | "repoRef"
  | "targetDir"
  | "volumeName"
  | "dockerGitPath"
  | "authorizedKeysPath"
  | "envGlobalPath"
  | "envProjectPath"
  | "codexAuthPath"
  | "codexSharedAuthPath"
  | "codexHome"
  | "geminiAuthPath"
  | "geminiHome"
> => ({
  containerName: input.names.containerName,
  serviceName: input.names.serviceName,
  sshUser: input.repo.sshUser,
  sshPort: input.repo.sshPort,
  repoUrl: input.repo.repoUrl,
  repoRef: input.repo.repoRef,
  targetDir: input.repo.targetDir,
  volumeName: input.names.volumeName,
  dockerGitPath: input.paths.dockerGitPath,
  authorizedKeysPath: input.paths.authorizedKeysPath,
  envGlobalPath: input.paths.envGlobalPath,
  envProjectPath: input.paths.envProjectPath,
  codexAuthPath: input.paths.codexAuthPath,
  codexSharedAuthPath: input.paths.codexSharedAuthPath,
  codexHome: input.paths.codexHome,
  geminiAuthPath: input.paths.geminiAuthPath,
  geminiHome: input.paths.geminiHome
})

const buildTemplateConfig = (input: BuildTemplateConfigInput): CreateCommand["config"] => ({
  ...buildTemplateConfigBase(input),
  gitTokenLabel: input.gitTokenLabel,
  skipGithubAuth: input.skipGithubAuth,
  codexAuthLabel: input.codexAuthLabel,
  claudeAuthLabel: input.claudeAuthLabel,
  cpuLimit: input.cpuLimit,
  ramLimit: input.ramLimit,
  playwrightCpuLimit: input.playwrightCpuLimit,
  playwrightRamLimit: input.playwrightRamLimit,
  dockerNetworkMode: input.dockerNetworkMode,
  dockerSharedNetworkName: input.dockerSharedNetworkName,
  enableMcpPlaywright: input.enableMcpPlaywright,
  bunVersion: defaultTemplateConfig.bunVersion,
  agentMode: input.agentMode,
  agentAuto: input.agentAuto,
  clonedOnHostname: input.clonedOnHostname
})

// CHANGE: build a typed create command from raw options (CLI or API)
// WHY: share deterministic command construction across CLI and server
// QUOTE(ТЗ): "В lib ты оставляешь бизнес логику, а все CLI морду хранишь в app"
// REF: user-request-2026-02-02-cli-split
// SOURCE: n/a
// FORMAT THEOREM: forall raw: build(raw) -> deterministic(command)
// PURITY: CORE
// EFFECT: Effect<CreateCommand, ParseError, never>
// INVARIANT: uses defaults for unset fields
// COMPLEXITY: O(1)
export const buildCreateCommand = (
  raw: RawOptions
): Either.Either<CreateCommand, ParseError> =>
  Either.gen(function*(_) {
    const repo = yield* _(resolveRepoBasics(raw))
    const names = yield* _(resolveNames(raw, repo.projectSlug))
    const paths = yield* _(resolvePaths(raw, repo.repoPath))
    const behavior = resolveCreateBehavior(raw)
    const gitTokenLabel = normalizeGitTokenLabel(raw.gitTokenLabel)
    const codexAuthLabel = normalizeAuthLabel(raw.codexTokenLabel)
    const claudeAuthLabel = normalizeAuthLabel(raw.claudeTokenLabel)
    const limits = yield* _(resolveResourceLimitsIntent(raw))
    const dockerNetworkMode = yield* _(parseDockerNetworkMode(raw.dockerNetworkMode))
    const dockerSharedNetworkName = yield* _(
      nonEmpty("--shared-network", raw.dockerSharedNetworkName, defaultTemplateConfig.dockerSharedNetworkName)
    )
    const { agentAuto, agentMode } = yield* _(resolveAutoAgentFlags(raw))

    return {
      _tag: "Create",
      outDir: paths.outDir,
      runUp: behavior.runUp,
      openSsh: behavior.openSsh,
      force: behavior.force,
      forceEnv: behavior.forceEnv,
      waitForClone: false,
      config: buildTemplateConfig({
        repo,
        names,
        paths,
        cpuLimit: limits.cpuLimit,
        ramLimit: limits.ramLimit,
        playwrightCpuLimit: limits.playwrightCpuLimit,
        playwrightRamLimit: limits.playwrightRamLimit,
        dockerNetworkMode,
        dockerSharedNetworkName,
        gitTokenLabel,
        skipGithubAuth: behavior.skipGithubAuth,
        codexAuthLabel,
        claudeAuthLabel,
        enableMcpPlaywright: behavior.enableMcpPlaywright,
        agentMode,
        agentAuto,
        clonedOnHostname: hostname()
      })
    }
  })
