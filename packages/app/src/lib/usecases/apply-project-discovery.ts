import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

import { deriveRepoPathParts } from "../core/domain.js"
import { parseGithubRepoUrl } from "../core/repo.js"
import { runCommandCapture, runCommandExitCode } from "../shell/command-runner.js"
import { readProjectConfig } from "../shell/config.js"
import { resolveBaseDir } from "../shell/paths.js"
import { findDockerGitConfigPaths } from "./docker-git-config-search.js"

export type RepoIdentity = {
  readonly fullPath: string
  readonly repo: string
}

export type ProjectCandidate = {
  readonly projectDir: string
  readonly repoUrl: string
  readonly repoRef: string
}

const gitSuccessExitCode = 0
const gitBaseEnv: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0"
}

const emptyConfigPaths = (): ReadonlyArray<string> => []
const nullProjectCandidate = (): ProjectCandidate | null => null
const nullString = (): string | null => null

export const normalizeRepoIdentity = (repoUrl: string): RepoIdentity => {
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

export const selectCandidateProjectDir = (
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

export const listProjectCandidates = (
  projectsRoot: string
): Effect.Effect<ReadonlyArray<ProjectCandidate>, PlatformError, FileSystem | Path> =>
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

export const collectRemoteIdentities = (
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

export const gitCapture = tryGitCapture
