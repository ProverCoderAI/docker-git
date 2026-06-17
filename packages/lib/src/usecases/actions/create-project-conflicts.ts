/* jscpd:ignore-start */
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { TemplateConfig } from "../../core/domain.js"
import { resolveComposeProjectName, resolveProjectBootstrapVolumeName } from "../../core/domain.js"
import { type DockerCommandError, DockerIdentityConflictError } from "../../shell/errors.js"
import type { ProjectStatus } from "../projects-core.js"
import { loadProjectIndex, loadProjectStatus } from "../projects-core.js"
import { deleteDockerGitProject } from "../projects-delete.js"

type CreateProjectRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type DockerIdentityOwner = Pick<
  TemplateConfig,
  "containerName" | "serviceName" | "volumeName" | "enableMcpPlaywright"
>

type DockerIdentityNamespace = "container" | "composeProject" | "volume"

type DockerIdentityClaim = Omit<DockerIdentityConflictError["conflicts"][number], "conflictingProjectDir"> & {
  readonly namespace: DockerIdentityNamespace
}

type ConflictState = {
  readonly conflicts: Array<DockerIdentityConflictError["conflicts"][number]>
  readonly conflictingProjects: Map<
    string,
    {
      readonly projectDir: string
      readonly repoUrl: string
      readonly containerName: string
      readonly serviceName: string
    }
  >
}

const resolveBrowserContainerClaims = (
  config: DockerIdentityOwner
): ReadonlyArray<DockerIdentityClaim> =>
  config.enableMcpPlaywright
    ? [{ namespace: "container", kind: "browserContainerName", name: `${config.containerName}-browser` }]
    : []

const resolveBrowserVolumeClaims = (
  config: DockerIdentityOwner
): ReadonlyArray<DockerIdentityClaim> =>
  config.enableMcpPlaywright
    ? [{ namespace: "volume", kind: "browserVolumeName", name: `${config.volumeName}-browser` }]
    : []

const resolveDockerIdentityClaims = (
  config: DockerIdentityOwner
): ReadonlyArray<DockerIdentityClaim> => [
  { namespace: "container", kind: "containerName", name: config.containerName },
  ...resolveBrowserContainerClaims(config),
  { namespace: "composeProject", kind: "serviceName", name: resolveComposeProjectName(config) },
  { namespace: "volume", kind: "volumeName", name: config.volumeName },
  ...resolveBrowserVolumeClaims(config),
  { namespace: "volume", kind: "bootstrapVolumeName", name: resolveProjectBootstrapVolumeName(config) }
]

const loadProjectStatusOrNull = (configPath: string) =>
  loadProjectStatus(configPath).pipe(
    Effect.match({
      onFailure: () => null,
      onSuccess: (value) => value
    })
  )

const collectSharedClaims = (
  candidateClaims: ReadonlyArray<DockerIdentityClaim>,
  existingClaims: ReadonlyArray<DockerIdentityClaim>,
  projectDir: string
): ReadonlyArray<DockerIdentityConflictError["conflicts"][number]> =>
  candidateClaims.flatMap((candidate) =>
    existingClaims.some(
        (existing) => existing.namespace === candidate.namespace && existing.name === candidate.name
      )
      ? [{ conflictingProjectDir: projectDir, kind: candidate.kind, name: candidate.name }]
      : []
  )

const appendClaims = (
  conflicts: Array<DockerIdentityConflictError["conflicts"][number]>,
  sharedClaims: ReadonlyArray<DockerIdentityConflictError["conflicts"][number]>
): void => {
  for (const claim of sharedClaims) {
    conflicts.push(claim)
  }
}

const rememberConflictingProject = (
  conflictingProjects: ConflictState["conflictingProjects"],
  status: ProjectStatus
): void => {
  conflictingProjects.set(status.projectDir, {
    projectDir: status.projectDir,
    repoUrl: status.config.template.repoUrl,
    containerName: status.config.template.containerName,
    serviceName: status.config.template.serviceName
  })
}

const scanConflicts = (
  resolvedOutDir: string,
  config: DockerIdentityOwner
): Effect.Effect<ConflictState | null, PlatformError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    const index = yield* _(loadProjectIndex())
    if (index === null) {
      return null
    }

    const candidateClaims = resolveDockerIdentityClaims(config)
    const state: ConflictState = {
      conflicts: [],
      conflictingProjects: new Map()
    }

    for (const configPath of index.configPaths) {
      const status = yield* _(loadProjectStatusOrNull(configPath))
      if (status === null || status.projectDir === resolvedOutDir) {
        continue
      }

      const sharedClaims = collectSharedClaims(
        candidateClaims,
        resolveDockerIdentityClaims(status.config.template),
        status.projectDir
      )
      if (sharedClaims.length === 0) {
        continue
      }

      appendClaims(state.conflicts, sharedClaims)
      rememberConflictingProject(state.conflictingProjects, status)
    }

    return state
  })

const deleteConflictingProjects = (
  conflictingProjects: ConflictState["conflictingProjects"]
): Effect.Effect<void, DockerCommandError | PlatformError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    for (const conflictingProject of conflictingProjects.values()) {
      yield* _(
        Effect.logWarning(
          `Force enabled: replacing conflicting docker-git project ${conflictingProject.projectDir}`
        )
      )
      yield* _(deleteDockerGitProject(conflictingProject))
    }
  })

export const deleteConflictingProjectsIfNeeded = (
  resolvedOutDir: string,
  config: DockerIdentityOwner,
  shouldForce: boolean
): Effect.Effect<void, DockerIdentityConflictError | PlatformError | DockerCommandError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    const state = yield* _(scanConflicts(resolvedOutDir, config))
    if (state === null || state.conflicts.length === 0) {
      return
    }

    if (!shouldForce) {
      return yield* _(
        Effect.fail(new DockerIdentityConflictError({ projectDir: resolvedOutDir, conflicts: state.conflicts }))
      )
    }

    yield* _(deleteConflictingProjects(state.conflictingProjects))
  })
/* jscpd:ignore-end */
