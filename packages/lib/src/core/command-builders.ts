import { Either } from "effect"

import { expandContainerHome } from "../usecases/scrap-path.js"
import { type RawOptions } from "./command-options.js"
import {
  type CreateCommand,
  defaultTemplateConfig,
  deriveRepoPathParts,
  deriveRepoSlug,
  isDockerNetworkMode,
  type ParseError,
  resolveRepoInput
} from "./domain.js"
import { trimRightChar } from "./strings.js"
import { normalizeAuthLabel, normalizeGitTokenLabel } from "./token-labels.js"

const parsePort = (value: string): Either.Either<number, ParseError> => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return Either.left({
      _tag: "InvalidOption",
      option: "--ssh-port",
      reason: `expected integer, got: ${value}`
    })
  }
  if (parsed < 1 || parsed > 65_535) {
    return Either.left({
      _tag: "InvalidOption",
      option: "--ssh-port",
      reason: "must be between 1 and 65535"
    })
  }
  return Either.right(parsed)
}

const parseDockerNetworkMode = (
  value: string | undefined
): Either.Either<CreateCommand["config"]["dockerNetworkMode"], ParseError> => {
  const candidate = value?.trim() ?? defaultTemplateConfig.dockerNetworkMode
  if (isDockerNetworkMode(candidate)) {
    return Either.right(candidate)
  }
  return Either.left({
    _tag: "InvalidOption",
    option: "--network-mode",
    reason: "expected one of: shared, project"
  })
}

export const nonEmpty = (
  option: string,
  value: string | undefined,
  fallback?: string
): Either.Either<string, ParseError> => {
  const candidate = value?.trim() ?? fallback
  if (candidate === undefined || candidate.length === 0) {
    return Either.left({
      _tag: "MissingRequiredOption",
      option
    })
  }
  return Either.right(candidate)
}

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
    const sshPort = yield* _(parsePort(raw.sshPort ?? String(defaultTemplateConfig.sshPort)))

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
  readonly outDir: string
}

type DefaultPathConfig = {
  readonly dockerGitPath: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
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
      codexAuthPath: defaultTemplateConfig.codexAuthPath
    }
    : {
      // NOTE: Keep docker-git root mount stable (projects root) so caches like
      // `.cache/git-mirrors` remain outside the secrets dir.
      dockerGitPath: defaultTemplateConfig.dockerGitPath,
      authorizedKeysPath: defaultTemplateConfig.authorizedKeysPath,
      envGlobalPath: `${normalizedSecretsRoot}/global.env`,
      envProjectPath: defaultTemplateConfig.envProjectPath,
      codexAuthPath: `${normalizedSecretsRoot}/codex`
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
    const outDir = yield* _(nonEmpty("--out-dir", raw.outDir, `.docker-git/${repoPath}`))

    return {
      dockerGitPath,
      authorizedKeysPath,
      envGlobalPath,
      envProjectPath,
      codexAuthPath,
      codexSharedAuthPath,
      codexHome,
      outDir
    }
  })

type CreateBehavior = {
  readonly runUp: boolean
  readonly openSsh: boolean
  readonly force: boolean
  readonly forceEnv: boolean
  readonly enableMcpPlaywright: boolean
}

const resolveCreateBehavior = (raw: RawOptions): CreateBehavior => ({
  runUp: raw.up ?? true,
  openSsh: raw.openSsh ?? false,
  force: raw.force ?? false,
  forceEnv: raw.forceEnv ?? false,
  enableMcpPlaywright: raw.enableMcpPlaywright ?? false
})

type BuildTemplateConfigInput = {
  readonly repo: RepoBasics
  readonly names: NameConfig
  readonly paths: PathConfig
  readonly dockerNetworkMode: CreateCommand["config"]["dockerNetworkMode"]
  readonly dockerSharedNetworkName: string
  readonly gitTokenLabel: string | undefined
  readonly codexAuthLabel: string | undefined
  readonly claudeAuthLabel: string | undefined
  readonly enableMcpPlaywright: boolean
}

const buildTemplateConfig = ({
  claudeAuthLabel,
  codexAuthLabel,
  dockerNetworkMode,
  dockerSharedNetworkName,
  enableMcpPlaywright,
  gitTokenLabel,
  names,
  paths,
  repo
}: BuildTemplateConfigInput): CreateCommand["config"] => ({
  containerName: names.containerName,
  serviceName: names.serviceName,
  sshUser: repo.sshUser,
  sshPort: repo.sshPort,
  repoUrl: repo.repoUrl,
  repoRef: repo.repoRef,
  gitTokenLabel,
  codexAuthLabel,
  claudeAuthLabel,
  targetDir: repo.targetDir,
  volumeName: names.volumeName,
  dockerGitPath: paths.dockerGitPath,
  authorizedKeysPath: paths.authorizedKeysPath,
  envGlobalPath: paths.envGlobalPath,
  envProjectPath: paths.envProjectPath,
  codexAuthPath: paths.codexAuthPath,
  codexSharedAuthPath: paths.codexSharedAuthPath,
  codexHome: paths.codexHome,
  dockerNetworkMode,
  dockerSharedNetworkName,
  enableMcpPlaywright,
  pnpmVersion: defaultTemplateConfig.pnpmVersion
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
    const dockerNetworkMode = yield* _(parseDockerNetworkMode(raw.dockerNetworkMode))
    const dockerSharedNetworkName = yield* _(
      nonEmpty("--shared-network", raw.dockerSharedNetworkName, defaultTemplateConfig.dockerSharedNetworkName)
    )

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
        dockerNetworkMode,
        dockerSharedNetworkName,
        gitTokenLabel,
        codexAuthLabel,
        claudeAuthLabel,
        enableMcpPlaywright: behavior.enableMcpPlaywright
      })
    }
  })
