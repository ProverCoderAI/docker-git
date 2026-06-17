import { Either } from "effect"

import { resolveAutoAgentFlags } from "./auto-agent-flags.js"
import {
  expandContainerHome,
  nonEmpty,
  parseDockerNetworkMode,
  parseGpuMode,
  parseSshPort,
  parseSshUser,
  trimTrailingPathSeparators
} from "./command-builders-shared.js"
import { buildTemplateConfig } from "./command-builders-template.js"
import { type RawOptions } from "./command-options.js"
import {
  type CreateCommand,
  defaultTemplateConfig,
  deriveRepoPathParts,
  deriveRepoSlug,
  type ParseError,
  resolveRepoInput
} from "./domain.js"
import { resolveResourceLimitsIntent } from "./resource-limits.js"
import { normalizeAuthLabel, normalizeGitTokenLabel } from "./token-labels.js"

export { nonEmpty } from "./command-builders-shared.js"

const normalizeSecretsRoot = trimTrailingPathSeparators

export type RepoBasics = {
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
    const repoPath = (workspaceSuffix ? [...repoPathParts, workspaceSuffix] : repoPathParts).join("/")
    const repoRef = yield* _(
      nonEmpty("--repo-ref", raw.repoRef ?? resolvedRepo.repoRef, defaultTemplateConfig.repoRef)
    )
    const sshUser = yield* _(parseSshUser(raw.sshUser))
    const rawTargetDir = yield* _(
      nonEmpty("--target-dir", raw.targetDir, defaultTemplateConfig.targetDir)
    )
    const targetDir = expandContainerHome(sshUser, rawTargetDir)
    const sshPort = yield* _(parseSshPort(raw.sshPort ?? String(defaultTemplateConfig.sshPort)))

    return { repoUrl, repoSlug, projectSlug, repoPath, repoRef, targetDir, sshUser, sshPort }
  })

export type NameConfig = {
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

export type PathConfig = {
  readonly dockerGitPath: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexSharedAuthPath: string
  readonly codexHome: string
  readonly geminiAuthPath: string
  readonly geminiHome: string
  readonly grokAuthPath: string
  readonly grokHome: string
  readonly outDir: string
}

type DefaultPathConfig = {
  readonly dockerGitPath: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly geminiAuthPath: string
  readonly grokAuthPath: string
}

const resolveNormalizedSecretsRoot = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length === 0 ? undefined : normalizeSecretsRoot(trimmed)
}

const joinSecretsRootPath = (root: string, child: string): string =>
  root.endsWith("/") || root.endsWith("\\") ? `${root}${child}` : `${root}/${child}`

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
      geminiAuthPath: defaultTemplateConfig.geminiAuthPath,
      grokAuthPath: defaultTemplateConfig.grokAuthPath
    }
    : {
      // NOTE: Keep docker-git root mount stable (projects root) so caches like
      // `.cache/git-mirrors` remain outside the secrets dir.
      dockerGitPath: defaultTemplateConfig.dockerGitPath,
      authorizedKeysPath: defaultTemplateConfig.authorizedKeysPath,
      envGlobalPath: joinSecretsRootPath(normalizedSecretsRoot, "global.env"),
      envProjectPath: defaultTemplateConfig.envProjectPath,
      codexAuthPath: joinSecretsRootPath(normalizedSecretsRoot, "codex"),
      geminiAuthPath: joinSecretsRootPath(normalizedSecretsRoot, "gemini"),
      grokAuthPath: joinSecretsRootPath(normalizedSecretsRoot, "grok")
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
    const grokAuthPath = defaults.grokAuthPath
    const grokHome = defaultTemplateConfig.grokHome
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
      grokAuthPath,
      grokHome,
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

type TokenLabelConfig = {
  readonly gitTokenLabel: string | undefined
  readonly codexAuthLabel: string | undefined
  readonly claudeAuthLabel: string | undefined
  readonly geminiAuthLabel: string | undefined
  readonly grokAuthLabel: string | undefined
}

const resolveTokenLabels = (raw: RawOptions): TokenLabelConfig => ({
  gitTokenLabel: normalizeGitTokenLabel(raw.gitTokenLabel),
  codexAuthLabel: normalizeAuthLabel(raw.codexTokenLabel),
  claudeAuthLabel: normalizeAuthLabel(raw.claudeTokenLabel),
  geminiAuthLabel: normalizeAuthLabel(raw.geminiTokenLabel),
  grokAuthLabel: normalizeAuthLabel(raw.grokTokenLabel)
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
    const tokenLabels = resolveTokenLabels(raw)
    const limits = yield* _(resolveResourceLimitsIntent(raw))
    const gpu = yield* _(parseGpuMode(raw.gpu))
    const dockerNetworkMode = yield* _(parseDockerNetworkMode(raw.dockerNetworkMode))
    const dockerSharedNetworkName = yield* _(
      nonEmpty("--shared-network", raw.dockerSharedNetworkName, defaultTemplateConfig.dockerSharedNetworkName)
    )
    const { agentAuto: isAgentAuto, agentMode } = yield* _(resolveAutoAgentFlags(raw))

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
        gpu,
        dockerNetworkMode,
        dockerSharedNetworkName,
        ...tokenLabels,
        skipGithubAuth: behavior.skipGithubAuth,
        enableMcpPlaywright: behavior.enableMcpPlaywright,
        agentMode,
        agentAuto: isAgentAuto,
        clonedOnHostname: raw.clonedOnHostname
      })
    }
  })
