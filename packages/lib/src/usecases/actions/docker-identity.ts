import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { TemplateConfig } from "../../core/domain.js"
import { resolveComposeProjectName, resolveProjectBootstrapVolumeName } from "../../core/domain.js"
import { DockerIdentityConflictError } from "../../shell/errors.js"
import type { DockerCommandError, DockerIdentityConflict } from "../../shell/errors.js"
import { loadProjectIndex, loadProjectStatus } from "../projects-core.js"
import { deleteDockerGitProject } from "../projects-delete.js"

type CreateProjectRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type DockerIdentityOwner = Pick<TemplateConfig, "containerName" | "serviceName" | "volumeName" | "enableMcpPlaywright">

type ConflictingProjectEntry = {
  readonly projectDir: string
  readonly repoUrl: string
  readonly containerName: string
  readonly serviceName: string
}

type DockerIdentityNamespace = "container" | "composeProject" | "volume"

type DockerIdentityClaim = Omit<DockerIdentityConflict, "conflictingProjectDir"> & {
  readonly namespace: DockerIdentityNamespace
}

const resolveDockerIdentityClaims = (
  config: DockerIdentityOwner
): ReadonlyArray<DockerIdentityClaim> => [
  { namespace: "container", kind: "containerName", name: config.containerName },
  ...(config.enableMcpPlaywright
    ? [
      {
        namespace: "container",
        kind: "browserContainerName",
        name: `${config.containerName}-browser`
      } satisfies DockerIdentityClaim
    ]
    : []),
  { namespace: "composeProject", kind: "serviceName", name: resolveComposeProjectName(config) },
  { namespace: "volume", kind: "volumeName", name: config.volumeName },
  ...(config.enableMcpPlaywright
    ? [
      {
        namespace: "volume",
        kind: "browserVolumeName",
        name: `${config.volumeName}-browser`
      } satisfies DockerIdentityClaim
    ]
    : []),
  { namespace: "volume", kind: "bootstrapVolumeName", name: resolveProjectBootstrapVolumeName(config) }
]

const detectDockerIdentityConflicts = (
  resolvedOutDir: string,
  config: DockerIdentityOwner,
  configPaths: ReadonlyArray<string>
): Effect.Effect<
  {
    readonly conflicts: ReadonlyArray<DockerIdentityConflict>
    readonly projects: Map<string, ConflictingProjectEntry>
  },
  PlatformError,
  CreateProjectRuntime
> =>
  Effect.gen(function*(_) {
    const candidateClaims = resolveDockerIdentityClaims(config)
    const conflicts: Array<DockerIdentityConflict> = []
    const projects = new Map<string, ConflictingProjectEntry>()
    for (const configPath of configPaths) {
      const status = yield* _(
        loadProjectStatus(configPath).pipe(
          Effect.match({
            onFailure: () => null,
            onSuccess: (value) => value
          })
        )
      )
      if (status === null || status.projectDir === resolvedOutDir) {
        continue
      }
      const existingClaims = resolveDockerIdentityClaims(status.config.template)
      const sharedClaims = candidateClaims.flatMap((candidate) =>
        existingClaims.some(
            (existing) => existing.namespace === candidate.namespace && existing.name === candidate.name
          )
          ? [{ conflictingProjectDir: status.projectDir, kind: candidate.kind, name: candidate.name }]
          : []
      )
      if (sharedClaims.length === 0) {
        continue
      }
      for (const claim of sharedClaims) conflicts.push(claim)
      projects.set(status.projectDir, {
        projectDir: status.projectDir,
        repoUrl: status.config.template.repoUrl,
        containerName: status.config.template.containerName,
        serviceName: status.config.template.serviceName
      })
    }
    return { conflicts, projects }
  })

export const deleteConflictingProjectsIfNeeded = (
  resolvedOutDir: string,
  config: DockerIdentityOwner,
  force: boolean
): Effect.Effect<void, DockerIdentityConflictError | PlatformError | DockerCommandError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    const index = yield* _(loadProjectIndex())
    if (index === null) return
    const { conflicts, projects } = yield* _(detectDockerIdentityConflicts(resolvedOutDir, config, index.configPaths))
    if (conflicts.length === 0) return
    if (!force) {
      return yield* _(Effect.fail(new DockerIdentityConflictError({ projectDir: resolvedOutDir, conflicts })))
    }
    for (const conflictingProject of projects.values()) {
      yield* _(
        Effect.logWarning(
          `Force enabled: replacing conflicting docker-git project ${conflictingProject.projectDir}`
        )
      )
      yield* _(deleteDockerGitProject(conflictingProject))
    }
  })
