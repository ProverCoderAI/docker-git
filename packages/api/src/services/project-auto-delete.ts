import { deleteDockerGitProject, listProjectItems, parseProjectSourceRef } from "@effect-template/lib"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { fetchProjectSourceState } from "@effect-template/lib/usecases/project-source-state"
import { ensureGhAuthImage, ghAuthRoot } from "@effect-template/lib/usecases/github-auth-image"
import { defaultProjectsRoot, resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { withFsPathContext } from "@effect-template/lib/usecases/runtime"
import { resolveGithubToken } from "@effect-template/lib/usecases/state-repo/github-auth"
import { Duration, Effect, Schedule } from "effect"

import { decideProjectClosedSourceAction } from "./project-closed-source-policy.js"
import { projectHasActiveAgent, projectHasLiveInteractiveSession } from "./project-activity.js"
import { loadProjectRuntimeByProject, runtimeForProject } from "./project-runtime.js"

// CHANGE: automatically delete containers whose originating issue or PR has been closed
// WHY: closed issues/PRs leave behind unused environments that pile up over time
// QUOTE(ТЗ): "Сделать возможность автоматического удаления контейнера issues или PR которого уже закрылся"
// REF: issue-117
// SOURCE: https://github.com/ProverCoderAI/docker-git/issues/117
// PURITY: SHELL
// INVARIANT: disabled by default; only ever deletes projects with a closed source and no live work

export type ProjectAutoDeleteConfig = {
  readonly enabled: boolean
  readonly scanIntervalMs: number
}

const secondMs = 1_000
const defaultScanIntervalSeconds = 300

const parsePositiveIntegerEnv = (
  key: string,
  defaultValue: number
): number => {
  const parsed = Number.parseInt(process.env[key] ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

const parseEnabledEnv = (
  key: string,
  defaultValue: boolean
): boolean => {
  const raw = process.env[key]?.trim().toLowerCase()
  if (raw === undefined || raw.length === 0) {
    return defaultValue
  }
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes"
}

// CHANGE: opt-in by default — deletion is irreversible, so require explicit enablement
// WHY: an unexpected auto-delete must never surprise a user; they must turn it on knowingly
// REF: issue-117
export const resolveProjectAutoDeleteConfig = (): ProjectAutoDeleteConfig => ({
  enabled: parseEnabledEnv("DOCKER_GIT_AUTO_DELETE_CLOSED", false),
  scanIntervalMs:
    parsePositiveIntegerEnv("DOCKER_GIT_AUTO_DELETE_SCAN_INTERVAL_SECONDS", defaultScanIntervalSeconds) * secondMs
})

type AutoDeleteRuntime = {
  readonly cwd: string
  readonly ghAuthHostPath: string
  readonly token: string
}

const evaluateProject = (
  runtime: AutoDeleteRuntime,
  project: ProjectItem,
  sshSessions: number
) =>
  Effect.gen(function*(_) {
    const ref = parseProjectSourceRef(project.repoUrl, project.repoRef)
    if (ref === null) {
      return
    }

    const sourceState = yield* _(
      fetchProjectSourceState(runtime.cwd, runtime.ghAuthHostPath, runtime.token, ref).pipe(
        Effect.catchAll(() => Effect.succeed("unknown" as const))
      )
    )

    const hasActiveAgent = yield* _(projectHasActiveAgent(project))
    const hasLiveInteractiveSession = projectHasLiveInteractiveSession(project, sshSessions)

    const decision = decideProjectClosedSourceAction({ sourceState, hasActiveAgent, hasLiveInteractiveSession })
    if (decision._tag === "Keep") {
      return
    }

    yield* _(
      Effect.log(
        `[auto-delete] Removing ${project.containerName}: ${ref.provider} ${ref.kind} #${ref.number} is closed`
      )
    )
    yield* _(
      deleteDockerGitProject({
        projectDir: project.projectDir,
        repoUrl: project.repoUrl,
        containerName: project.containerName,
        serviceName: project.serviceName
      })
    )
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(
        `[auto-delete] Failed to evaluate ${project.containerName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    )
  )

export const scanProjectAutoDelete = (
  config: ProjectAutoDeleteConfig
) =>
  Effect.gen(function*(_) {
    if (!config.enabled) {
      return
    }

    const projects = yield* _(listProjectItems)
    const sourceProjects = projects.filter((project) => parseProjectSourceRef(project.repoUrl, project.repoRef) !== null)
    if (sourceProjects.length === 0) {
      return
    }

    const runtime = yield* _(
      withFsPathContext(({ cwd, fs, path }) =>
        Effect.gen(function*(_) {
          const root = path.resolve(defaultProjectsRoot(cwd))
          const token = yield* _(resolveGithubToken(fs, path, root))
          if (token === null) {
            return null
          }
          const ghAuthHostPath = resolvePathFromCwd(path, cwd, ghAuthRoot)
          yield* _(ensureGhAuthImage(fs, path, cwd, "gh api"))
          return { cwd, ghAuthHostPath, token } satisfies AutoDeleteRuntime
        })
      )
    )

    if (runtime === null) {
      yield* _(Effect.logWarning("[auto-delete] No GitHub token available; skipping closed-source cleanup scan"))
      return
    }

    const runtimeByProject = yield* _(loadProjectRuntimeByProject(sourceProjects))
    yield* _(
      Effect.forEach(
        sourceProjects,
        (project) => evaluateProject(runtime, project, runtimeForProject(runtimeByProject, project).sshSessions),
        { concurrency: 2, discard: true }
      )
    )
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(
        `[auto-delete] Scan failed: ${error instanceof Error ? error.message : String(error)}`
      )
    )
  )

export const startProjectAutoDeleteLoop = (
  config: ProjectAutoDeleteConfig
) =>
  config.enabled
    ? scanProjectAutoDelete(config).pipe(
      Effect.repeat(Schedule.addDelay(Schedule.forever, () => Duration.millis(config.scanIntervalMs)))
    )
    : Effect.log("docker-git auto-delete (closed issue/PR) disabled.")
