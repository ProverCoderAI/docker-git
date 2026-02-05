import { Either } from "effect"

import { type RawOptions } from "./command-options.js"
import {
  type CreateCommand,
  defaultTemplateConfig,
  deriveRepoPathParts,
  deriveRepoSlug,
  type ParseError,
  resolveRepoInput
} from "./domain.js"
import { trimRightChar } from "./strings.js"

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
  readonly repoPath: string
  readonly repoRef: string
  readonly targetDir: string
  readonly sshUser: string
  readonly sshPort: number
}

const resolveRepoBasics = (raw: RawOptions): Either.Either<RepoBasics, ParseError> =>
  Either.gen(function*(_) {
    const rawRepoUrl = yield* _(nonEmpty("--repo-url", raw.repoUrl))
    const resolvedRepo = resolveRepoInput(rawRepoUrl)
    const repoUrl = resolvedRepo.repoUrl
    const repoSlug = deriveRepoSlug(repoUrl)
    const repoPath = deriveRepoPathParts(repoUrl).pathParts.join("/")
    const repoRef = yield* _(
      nonEmpty("--repo-ref", raw.repoRef ?? resolvedRepo.repoRef, defaultTemplateConfig.repoRef)
    )
    const targetDir = yield* _(
      nonEmpty("--target-dir", raw.targetDir, defaultTemplateConfig.targetDir)
    )
    const sshUser = yield* _(nonEmpty("--ssh-user", raw.sshUser, defaultTemplateConfig.sshUser))
    const sshPort = yield* _(parsePort(raw.sshPort ?? String(defaultTemplateConfig.sshPort)))

    return { repoUrl, repoSlug, repoPath, repoRef, targetDir, sshUser, sshPort }
  })

type NameConfig = {
  readonly containerName: string
  readonly serviceName: string
  readonly volumeName: string
}

const resolveNames = (
  raw: RawOptions,
  repoSlug: string
): Either.Either<NameConfig, ParseError> =>
  Either.gen(function*(_) {
    const derivedContainerName = `dg-${repoSlug}`
    const derivedServiceName = `dg-${repoSlug}`
    const derivedVolumeName = `dg-${repoSlug}-home`
    const containerName = yield* _(
      nonEmpty("--container-name", raw.containerName, derivedContainerName)
    )
    const serviceName = yield* _(nonEmpty("--service-name", raw.serviceName, derivedServiceName))
    const volumeName = yield* _(nonEmpty("--volume-name", raw.volumeName, derivedVolumeName))

    return { containerName, serviceName, volumeName }
  })

type PathConfig = {
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
  readonly outDir: string
}

const resolvePaths = (
  raw: RawOptions,
  repoSlug: string,
  repoPath: string
): Either.Either<PathConfig, ParseError> =>
  Either.gen(function*(_) {
    const secretsRoot = raw.secretsRoot?.trim()
    const normalizedSecretsRoot = secretsRoot === undefined || secretsRoot.length === 0
      ? undefined
      : normalizeSecretsRoot(secretsRoot)
    const defaultAuthorizedKeysPath = normalizedSecretsRoot === undefined
      ? defaultTemplateConfig.authorizedKeysPath
      : `${normalizedSecretsRoot}/authorized_keys`
    const defaultEnvGlobalPath = normalizedSecretsRoot === undefined
      ? defaultTemplateConfig.envGlobalPath
      : `${normalizedSecretsRoot}/global.env`
    const defaultEnvProjectPath = normalizedSecretsRoot === undefined
      ? defaultTemplateConfig.envProjectPath
      : `${normalizedSecretsRoot}/${repoSlug}.env`
    const defaultCodexAuthPath = normalizedSecretsRoot === undefined
      ? defaultTemplateConfig.codexAuthPath
      : `${normalizedSecretsRoot}/codex`
    const authorizedKeysPath = yield* _(
      nonEmpty("--authorized-keys", raw.authorizedKeysPath, defaultAuthorizedKeysPath)
    )
    const envGlobalPath = yield* _(nonEmpty("--env-global", raw.envGlobalPath, defaultEnvGlobalPath))
    const envProjectPath = yield* _(
      nonEmpty("--env-project", raw.envProjectPath, defaultEnvProjectPath)
    )
    const codexAuthPath = yield* _(
      nonEmpty("--codex-auth", raw.codexAuthPath, defaultCodexAuthPath)
    )
    const codexHome = yield* _(nonEmpty("--codex-home", raw.codexHome, defaultTemplateConfig.codexHome))
    const outDir = yield* _(nonEmpty("--out-dir", raw.outDir, `.docker-git/${repoPath}`))

    return { authorizedKeysPath, envGlobalPath, envProjectPath, codexAuthPath, codexHome, outDir }
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
    const names = yield* _(resolveNames(raw, repo.repoSlug))
    const paths = yield* _(resolvePaths(raw, repo.repoSlug, repo.repoPath))
    const runUp = raw.up ?? true
    const force = raw.force ?? false

    return {
      _tag: "Create",
      outDir: paths.outDir,
      runUp,
      force,
      waitForClone: false,
      config: {
        containerName: names.containerName,
        serviceName: names.serviceName,
        sshUser: repo.sshUser,
        sshPort: repo.sshPort,
        repoUrl: repo.repoUrl,
        repoRef: repo.repoRef,
        targetDir: repo.targetDir,
        volumeName: names.volumeName,
        authorizedKeysPath: paths.authorizedKeysPath,
        envGlobalPath: paths.envGlobalPath,
        envProjectPath: paths.envProjectPath,
        codexAuthPath: paths.codexAuthPath,
        codexHome: paths.codexHome,
        pnpmVersion: defaultTemplateConfig.pnpmVersion
      }
    }
  })
