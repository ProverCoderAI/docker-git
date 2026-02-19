import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

import { type ApplyCommand, deriveRepoPathParts, type TemplateConfig } from "../core/domain.js"
import { parseGithubRepoUrl } from "../core/repo.js"
import { runCommandCapture, runCommandExitCode } from "../shell/command-runner.js"
import { readProjectConfig } from "../shell/config.js"
import { ensureDockerDaemonAccess } from "../shell/docker.js"
import type * as ShellErrors from "../shell/errors.js"
import { writeProjectFiles } from "../shell/files.js"
import { resolveBaseDir } from "../shell/paths.js"
import { ensureCodexConfigFile } from "./auth-sync.js"
import { findDockerGitConfigPaths } from "./docker-git-config-search.js"
import { defaultProjectsRoot, findExistingUpwards } from "./path-helpers.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"

type ApplyProjectFilesError =
  | ShellErrors.ConfigNotFoundError
  | ShellErrors.ConfigDecodeError
  | ShellErrors.FileExistsError
  | PlatformError
type ApplyProjectFilesEnv = FileSystem | Path

// CHANGE: apply existing docker-git.json to managed files in an already created project
// WHY: allow updating current project/container config without creating a new project directory
// QUOTE(ТЗ): "Не создавать новый... а прямо в текущем обновить её на актуальную"
// REF: issue-72-followup-apply-current-config
// SOURCE: n/a
// FORMAT THEOREM: forall p: apply_files(p) -> files(p) = plan(read_config(p))
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, ConfigNotFoundError | ConfigDecodeError | FileExistsError | PlatformError, FileSystem | Path>
// INVARIANT: rewrites only managed files from docker-git.json
// COMPLEXITY: O(n) where n = |managed_files|
export const applyProjectFiles = (
  projectDir: string
): Effect.Effect<TemplateConfig, ApplyProjectFilesError, ApplyProjectFilesEnv> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Applying docker-git config files in ${projectDir}...`))
    const config = yield* _(readProjectConfig(projectDir))
    yield* _(writeProjectFiles(projectDir, config.template, true))
    yield* _(ensureCodexConfigFile(projectDir, config.template.codexAuthPath))
    return config.template
  })

export type ApplyProjectConfigError =
  | ApplyProjectFilesError
  | ShellErrors.DockerAccessError
  | ShellErrors.DockerCommandError
  | ShellErrors.PortProbeError

type ApplyProjectConfigEnv = ApplyProjectFilesEnv | CommandExecutor

type RepoIdentity = {
  readonly fullPath: string
  readonly repo: string
}

type ProjectCandidate = {
  readonly projectDir: string
  readonly repoUrl: string
  readonly repoRef: string
}

const gitSuccessExitCode = 0
const gitBranchDetached = "HEAD"
const maxLocalConfigSearchDepth = 6
const gitBaseEnv: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0"
}

const emptyConfigPaths = (): ReadonlyArray<string> => []
const nullProjectCandidate = (): ProjectCandidate | null => null
const nullString = (): string | null => null

const normalizeRepoIdentity = (repoUrl: string): RepoIdentity => {
  const github = parseGithubRepoUrl(repoUrl)
  if (github !== null) {
    const owner = github.owner.trim().toLowerCase()
    const repo = github.repo.trim().toLowerCase()
    return { fullPath: `${owner}/${repo}`, repo }
  }

  const parts = deriveRepoPathParts(repoUrl)
  const normalizedParts = parts.pathParts.map((part) => part.toLowerCase())
  const repo = parts.repo.toLowerCase()
  return {
    fullPath: normalizedParts.join("/"),
    repo
  }
}

const toProjectDirBaseName = (projectDir: string): string => {
  const normalized = projectDir.replaceAll("\\", "/")
  const parts = normalized.split("/").filter((part) => part.length > 0)
  return parts.at(-1)?.toLowerCase() ?? ""
}

const parsePrRefFromBranch = (branch: string): string | null => {
  const prefix = "pr-"
  if (!branch.toLowerCase().startsWith(prefix)) {
    return null
  }
  const id = branch.slice(prefix.length).trim()
  return id.length > 0 ? `refs/pull/${id}/head` : null
}

const scoreBranchMatch = (
  branch: string | null,
  candidate: ProjectCandidate
): number => {
  if (branch === null) {
    return 0
  }

  const branchLower = branch.toLowerCase()
  const candidateRef = candidate.repoRef.toLowerCase()
  const prRef = parsePrRefFromBranch(branchLower)
  const branchRefScore = candidateRef === branchLower ? 8 : 0
  const prRefScore = prRef !== null && candidateRef === prRef.toLowerCase() ? 8 : 0
  const dirNameScore = toProjectDirBaseName(candidate.projectDir) === branchLower ? 5 : 0
  return branchRefScore + prRefScore + dirNameScore
}

const scoreCandidate = (
  remoteIdentities: ReadonlyArray<RepoIdentity>,
  branch: string | null,
  candidate: ProjectCandidate
): number => {
  const candidateIdentity = normalizeRepoIdentity(candidate.repoUrl)
  const hasFullPathMatch = remoteIdentities.some((remote) => remote.fullPath === candidateIdentity.fullPath)
  const hasRepoMatch = remoteIdentities.some((remote) => remote.repo === candidateIdentity.repo)
  if (!hasFullPathMatch && !hasRepoMatch) {
    return 0
  }

  const repoScore = hasFullPathMatch ? 100 : 10
  return repoScore + scoreBranchMatch(branch, candidate)
}

const selectCandidateProjectDir = (
  remoteIdentities: ReadonlyArray<RepoIdentity>,
  branch: string | null,
  candidates: ReadonlyArray<ProjectCandidate>
): string | null => {
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(remoteIdentities, branch, candidate) }))
    .filter((entry) => entry.score > 0)

  if (scored.length === 0) {
    return null
  }

  const topScore = Math.max(...scored.map((entry) => entry.score))
  const topCandidates = scored.filter((entry) => entry.score === topScore)
  if (topCandidates.length !== 1) {
    return null
  }

  return topCandidates[0]?.candidate.projectDir ?? null
}

const tryGitCapture = (
  cwd: string,
  args: ReadonlyArray<string>
): Effect.Effect<string | null, never, CommandExecutor> => {
  const spec = { cwd, command: "git", args, env: gitBaseEnv }

  return runCommandExitCode(spec).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.succeed<string | null>(null),
      onSuccess: (exitCode) =>
        exitCode === gitSuccessExitCode
          ? runCommandCapture(spec, [gitSuccessExitCode], (code) => ({ _tag: "ApplyGitCaptureError", code })).pipe(
            Effect.map((value) => value.trim()),
            Effect.match({
              onFailure: nullString,
              onSuccess: (value) => value
            })
          )
          : Effect.succeed<string | null>(null)
    })
  )
}

const listProjectCandidates = (
  projectsRoot: string
): Effect.Effect<ReadonlyArray<ProjectCandidate>, PlatformError, ApplyProjectFilesEnv> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(projectsRoot))
    const configPaths = yield* _(
      findDockerGitConfigPaths(fs, path, resolved).pipe(
        Effect.match({
          onFailure: emptyConfigPaths,
          onSuccess: (value) => value
        })
      )
    )

    const candidates: Array<ProjectCandidate> = []
    for (const configPath of configPaths) {
      const projectDir = path.dirname(configPath)
      const candidate = yield* _(
        readProjectConfig(projectDir).pipe(
          Effect.match({
            onFailure: nullProjectCandidate,
            onSuccess: (config) => ({
              projectDir,
              repoUrl: config.template.repoUrl,
              repoRef: config.template.repoRef
            })
          })
        )
      )
      if (candidate !== null) {
        candidates.push(candidate)
      }
    }

    return candidates
  })

const collectRemoteIdentities = (
  repoRoot: string
): Effect.Effect<ReadonlyArray<RepoIdentity>, never, CommandExecutor> =>
  Effect.gen(function*(_) {
    const listedRemotes = yield* _(tryGitCapture(repoRoot, ["remote"]))
    const dynamicNames = listedRemotes === null
      ? []
      : listedRemotes
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    const remoteNames = [...new Set([...dynamicNames, "origin", "upstream"])]
    const urls: Array<string> = []

    for (const remoteName of remoteNames) {
      const url = yield* _(tryGitCapture(repoRoot, ["remote", "get-url", remoteName]))
      if (url !== null && url.length > 0) {
        urls.push(url)
      }
    }

    const identityMap = new Map<string, RepoIdentity>()
    for (const url of urls) {
      const identity = normalizeRepoIdentity(url)
      identityMap.set(`${identity.fullPath}|${identity.repo}`, identity)
    }
    return [...identityMap.values()]
  })

const resolveFromCurrentTree = (): Effect.Effect<string | null, PlatformError, ApplyProjectFilesEnv> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir("."))
    const configPath = yield* _(
      findExistingUpwards(fs, path, resolved, "docker-git.json", maxLocalConfigSearchDepth).pipe(
        Effect.match({
          onFailure: nullString,
          onSuccess: (value) => value
        })
      )
    )
    return configPath === null ? null : path.dirname(configPath)
  })

const normalizeBranch = (branch: string | null): string | null => {
  const normalized = branch?.trim() ?? ""
  if (normalized.length === 0 || normalized === gitBranchDetached) {
    return null
  }
  return normalized
}

const resolveFromCurrentRepository = (): Effect.Effect<string | null, PlatformError, ApplyProjectConfigEnv> =>
  Effect.gen(function*(_) {
    const cwd = process.cwd()
    const repoRoot = yield* _(tryGitCapture(cwd, ["rev-parse", "--show-toplevel"]))
    if (repoRoot === null) {
      return null
    }

    const remoteIdentities = yield* _(collectRemoteIdentities(repoRoot))
    if (remoteIdentities.length === 0) {
      return null
    }

    const branch = normalizeBranch(yield* _(tryGitCapture(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])))
    const projectsRoot = defaultProjectsRoot(cwd)
    const candidates = yield* _(listProjectCandidates(projectsRoot))
    if (candidates.length === 0) {
      return null
    }

    return selectCandidateProjectDir(remoteIdentities, branch, candidates)
  })

const resolveImplicitApplyProjectDir = (): Effect.Effect<string | null, PlatformError, ApplyProjectConfigEnv> =>
  Effect.gen(function*(_) {
    const localProjectDir = yield* _(resolveFromCurrentTree())
    if (localProjectDir !== null) {
      return localProjectDir
    }
    return yield* _(resolveFromCurrentRepository())
  })

const runApplyForProjectDir = (
  projectDir: string,
  runUp: boolean
): Effect.Effect<TemplateConfig, ApplyProjectConfigError, ApplyProjectConfigEnv> =>
  runUp ? applyProjectWithUp(projectDir) : applyProjectFiles(projectDir)

const applyProjectWithUp = (
  projectDir: string
): Effect.Effect<TemplateConfig, ApplyProjectConfigError, ApplyProjectConfigEnv> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Applying docker-git config and refreshing container in ${projectDir}...`))
    yield* _(ensureDockerDaemonAccess(process.cwd()))
    return yield* _(runDockerComposeUpWithPortCheck(projectDir))
  })

// CHANGE: add command handler to apply docker-git config on an existing project
// WHY: update current project/container config without running create/clone again
// QUOTE(ТЗ): "Не создавать новый... а прямо в текущем обновить её на актуальную"
// REF: issue-72-followup-apply-current-config
// SOURCE: n/a
// FORMAT THEOREM: forall c: apply(c) -> updated(project(c)) && (c.runUp -> container_refreshed(c))
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, ApplyProjectConfigError, FileSystem | Path | CommandExecutor>
// INVARIANT: project path remains unchanged; command only updates managed artifacts
// COMPLEXITY: O(n) + O(command)
export const applyProjectConfig = (
  command: ApplyCommand
): Effect.Effect<TemplateConfig, ApplyProjectConfigError, ApplyProjectConfigEnv> =>
  runApplyForProjectDir(command.projectDir, command.runUp).pipe(
    Effect.catchTag("ConfigNotFoundError", (error) =>
      command.projectDir === "."
        ? Effect.gen(function*(_) {
          const inferredProjectDir = yield* _(resolveImplicitApplyProjectDir())
          if (inferredProjectDir === null) {
            return yield* _(Effect.fail(error))
          }
          yield* _(Effect.log(`Auto-resolved docker-git project directory: ${inferredProjectDir}`))
          return yield* _(runApplyForProjectDir(inferredProjectDir, command.runUp))
        })
        : Effect.fail(error))
  )
