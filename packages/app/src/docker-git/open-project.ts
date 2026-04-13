import { Effect } from "effect"

import type { OpenCommand } from "./frontend-lib/core/domain.js"
import { parseGithubRepoUrl, resolveRepoInput } from "./frontend-lib/core/repo.js"

import { getProject, listProjects } from "./api-client.js"
import type { ApiProjectDetails } from "./api-project-codec.js"
import type { ProjectResolutionError } from "./host-errors.js"
import { openResolvedProjectSsh } from "./open-project-ssh.js"
import { resolveApiProjectItem } from "./project-item.js"

export type DockerContainerRuntimeInfo = {
  readonly ipAddress: string
  readonly projectWorkingDir?: string | undefined
}

export {
  openResolvedProjectSsh,
  openResolvedProjectSshViaController,
  openHostProjectSshEffect,
  type OpenResolvedProjectSshDeps,
  type OpenHostProjectSshDeps,
  openResolvedProjectSshEffect
} from "./open-project-ssh.js"

type ResolveOpenProjectDeps<E, R> = {
  readonly inspectRuntime: (containerName: string) => Effect.Effect<DockerContainerRuntimeInfo | null, E, R>
}

const normalizeText = (value: string): string => value.trim().toLowerCase()

const normalizePath = (value: string): string => {
  let normalized = value.trim().replaceAll("\\", "/")
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2)
  }
  return normalized
}

const renderProjectCandidate = (project: ApiProjectDetails): string =>
  `${project.displayName} [${project.containerName}] ${project.repoRef}`

const projectResolutionError = (message: string): ProjectResolutionError => ({
  _tag: "ProjectResolutionError",
  message
})

const hasGithubSelector = (value: string): boolean => parseGithubRepoUrl(value) !== null

const resolveRepoSelector = (value: string) => {
  const resolved = resolveRepoInput(value)
  const github = parseGithubRepoUrl(value)
  if (github === null) {
    return resolved
  }
  return {
    ...resolved,
    repoUrl: `https://github.com/${github.owner}/${github.repo}.git`
  }
}

const matchesProjectPath = (selector: string, project: ApiProjectDetails): boolean => {
  const normalizedSelector = normalizePath(selector)
  if (normalizedSelector.length === 0) {
    return false
  }

  const normalizedProjectId = normalizePath(project.id)
  const normalizedProjectDir = normalizePath(project.projectDir)

  return normalizedProjectId === normalizedSelector ||
    normalizedProjectDir === normalizedSelector ||
    normalizedProjectId.endsWith(`/${normalizedSelector}`) ||
    normalizedProjectDir.endsWith(`/${normalizedSelector}`)
}

const matchesProjectText = (selector: string, project: ApiProjectDetails): boolean => {
  const normalizedSelector = normalizeText(selector)
  if (normalizedSelector.length === 0) {
    return false
  }

  return normalizedSelector === normalizeText(project.containerName) ||
    normalizedSelector === normalizeText(project.serviceName) ||
    normalizedSelector === normalizeText(project.displayName)
}

const matchesProjectRepo = (selector: string, project: ApiProjectDetails): boolean => {
  if (!hasGithubSelector(selector)) {
    return false
  }

  const resolved = resolveRepoSelector(selector)
  if (project.repoUrl !== resolved.repoUrl) {
    return false
  }

  return resolved.repoRef === undefined ? true : project.repoRef === resolved.repoRef
}

const preferSingleRunning = (
  projects: ReadonlyArray<ApiProjectDetails>
): ApiProjectDetails | null => {
  const running = projects.filter((project) => project.status === "running")
  return running.length === 1 ? (running[0] ?? null) : null
}

const exactRuntimeMatches = (
  selector: string,
  projects: ReadonlyArray<ApiProjectDetails>
): ReadonlyArray<ApiProjectDetails> => {
  const normalizedSelector = normalizeText(selector)
  if (normalizedSelector.length === 0) {
    return []
  }
  return projects.filter((project) =>
    normalizedSelector === normalizeText(project.containerName) ||
    normalizedSelector === normalizeText(project.serviceName)
  )
}

const resolvesExactRuntimeSelector = (
  selector: string,
  projects: ReadonlyArray<ApiProjectDetails>
): ApiProjectDetails | null => {
  if (projects.length === 0) {
    return null
  }

  const matches = exactRuntimeMatches(selector, projects)
  if (matches.length !== projects.length) {
    return null
  }

  return preferSingleRunning(matches) ?? matches[0] ?? null
}

const resolveUniqueProject = (
  matches: ReadonlyArray<ApiProjectDetails>,
  notFoundMessage: string,
  ambiguousPrefix: string
): Effect.Effect<ApiProjectDetails, ProjectResolutionError> => {
  if (matches.length === 0) {
    return Effect.fail(projectResolutionError(notFoundMessage))
  }

  const running = preferSingleRunning(matches)
  if (running !== null) {
    return Effect.succeed(running)
  }

  if (matches.length === 1) {
    return Effect.succeed(matches[0]!)
  }

  const candidates = matches
    .slice(0, 5)
    .map((project) => renderProjectCandidate(project))
    .join(", ")

  return Effect.fail(
    projectResolutionError(`${ambiguousPrefix} Matches: ${candidates}`)
  )
}

const resolveProjectWithoutSelector = (
  projects: ReadonlyArray<ApiProjectDetails>
): Effect.Effect<ApiProjectDetails, ProjectResolutionError> => {
  if (projects.length === 0) {
    return Effect.fail(projectResolutionError("No docker-git projects found."))
  }

  const running = preferSingleRunning(projects)
  if (running !== null) {
    return Effect.succeed(running)
  }

  if (projects.length === 1) {
    return Effect.succeed(projects[0]!)
  }

  const runningCount = projects.filter((project) => project.status === "running").length
  const prefix = runningCount > 1
    ? "Multiple running docker-git projects found. Specify container name or repo URL."
    : "Multiple docker-git projects found. Specify container name or repo URL."

  return Effect.fail(projectResolutionError(prefix))
}

export const selectOpenProject = (
  projects: ReadonlyArray<ApiProjectDetails>,
  selector?: string
): Effect.Effect<ApiProjectDetails, ProjectResolutionError> => {
  const trimmed = selector?.trim() ?? ""
  if (trimmed.length === 0) {
    return resolveProjectWithoutSelector(projects)
  }

  const directMatches = projects.filter((project) =>
    matchesProjectPath(trimmed, project) || matchesProjectText(trimmed, project)
  )

  if (directMatches.length > 0) {
    const exactRuntimeMatch = resolvesExactRuntimeSelector(trimmed, directMatches)
    if (exactRuntimeMatch !== null) {
      return Effect.succeed(exactRuntimeMatch)
    }

    return resolveUniqueProject(
      directMatches,
      `No docker-git project matched '${trimmed}'.`,
      `Multiple docker-git projects matched '${trimmed}'.`
    )
  }

  const repoMatches = projects.filter((project) => matchesProjectRepo(trimmed, project))
  return resolveUniqueProject(
    repoMatches,
    `No docker-git project matched '${trimmed}'.`,
    `Multiple docker-git projects matched '${trimmed}'.`
  )
}

const uniqueContainerNames = (
  projects: ReadonlyArray<ApiProjectDetails>
): ReadonlyArray<string> => [...new Set(projects.map((project) => project.containerName))]

export const resolveRuntimeOwnedProject = <E, R>(
  projects: ReadonlyArray<ApiProjectDetails>,
  selector: string | undefined,
  deps: ResolveOpenProjectDeps<E, R>
): Effect.Effect<ApiProjectDetails | null, E, R> =>
  Effect.gen(function*(_) {
    const trimmed = selector?.trim() ?? ""
    const matches = exactRuntimeMatches(trimmed, projects)
    if (matches.length === 0) {
      return null
    }

    for (const containerName of uniqueContainerNames(matches)) {
      const runtime = yield* _(deps.inspectRuntime(containerName))
      const ownerDir = runtime?.projectWorkingDir
      if (ownerDir === undefined) {
        continue
      }
      const owner = matches.find((project) => normalizePath(project.projectDir) === normalizePath(ownerDir))
      if (owner !== undefined) {
        return owner
      }
    }

    return null
  })

export const resolveOpenProjectEffect = <E, R>(
  projects: ReadonlyArray<ApiProjectDetails>,
  selector: string | undefined,
  deps: ResolveOpenProjectDeps<E, R>
): Effect.Effect<ApiProjectDetails, ProjectResolutionError | E, R> =>
  resolveRuntimeOwnedProject(projects, selector, deps).pipe(
    Effect.flatMap((ownedProject) =>
      ownedProject === null ? selectOpenProject(projects, selector) : Effect.succeed(ownedProject)
    )
  )

const listProjectDetails = () =>
  Effect.gen(function*(_) {
    const summaries = yield* _(listProjects())
    const details = yield* _(
      Effect.forEach(
        summaries,
        (summary) => getProject(summary.id),
        { concurrency: 4 }
      )
    )
    return details.filter((project): project is ApiProjectDetails => project !== null)
  })

export const openExistingProjectSsh = (
  command: OpenCommand
) =>
  Effect.gen(function*(_) {
    const projects = yield* _(listProjectDetails())
    const selector = command.projectDir ?? command.projectRef
    const project = yield* _(selectOpenProject(projects, selector))
    const item = resolveApiProjectItem(project)
    yield* _(openResolvedProjectSsh(item))
  })
