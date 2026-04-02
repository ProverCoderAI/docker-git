import * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import { defaultTemplateConfig } from "@lib/core/domain"
import { buildSshCommand, getContainerIpIfInsideContainer, type ProjectItem } from "@lib/usecases/projects"

import type { ApiProjectDetails } from "./api-project-codec.js"
import { resolveHostPrivateKeyPath } from "./host-ssh-material.js"

const controllerManagedAuthorizedKeysPath = (projectDir: string): string => `${projectDir}/authorized_keys`

export const projectItemFromApiDetails = (
  project: ApiProjectDetails,
  sshKeyPath: string | null,
  ipAddress?: string
): ProjectItem => ({
  projectDir: project.projectDir,
  displayName: project.displayName,
  repoUrl: project.repoUrl,
  repoRef: project.repoRef,
  containerName: project.containerName,
  serviceName: project.serviceName,
  sshUser: project.sshUser,
  sshPort: project.sshPort,
  targetDir: project.targetDir,
  sshCommand: buildSshCommand(
    {
      ...defaultTemplateConfig,
      containerName: project.containerName,
      serviceName: project.serviceName,
      sshUser: project.sshUser,
      sshPort: project.sshPort,
      repoUrl: project.repoUrl,
      repoRef: project.repoRef,
      targetDir: project.targetDir,
      envGlobalPath: project.envGlobalPath,
      envProjectPath: project.envProjectPath,
      codexAuthPath: project.codexAuthPath,
      codexSharedAuthPath: project.codexAuthPath,
      codexHome: project.codexHome,
      clonedOnHostname: project.clonedOnHostname
    },
    sshKeyPath,
    ipAddress
  ),
  ipAddress,
  sshKeyPath,
  authorizedKeysPath: controllerManagedAuthorizedKeysPath(project.projectDir),
  authorizedKeysExists: true,
  envGlobalPath: project.envGlobalPath,
  envProjectPath: project.envProjectPath,
  codexAuthPath: project.codexAuthPath,
  codexHome: project.codexHome,
  clonedOnHostname: project.clonedOnHostname
})

export const resolveApiProjectItem = (
  project: ApiProjectDetails
) =>
  Effect.gen(function*(_) {
    const sshKeyPath = yield* _(resolveHostPrivateKeyPath())
    return yield* _(resolveApiProjectItemWithSshKeyPath(project, sshKeyPath))
  })

const resolveProjectItemIpAddress = (containerName: string) =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    return yield* _(
      getContainerIpIfInsideContainer(fs, process.cwd(), containerName).pipe(
        Effect.orElse(() => Effect.succeed<string | undefined>(""))
      )
    )
  })

export const resolveApiProjectItemWithSshKeyPath = (
  project: ApiProjectDetails,
  sshKeyPath: string | null
) =>
  Effect.gen(function*(_) {
    const ipAddress = yield* _(resolveProjectItemIpAddress(project.containerName))
    return projectItemFromApiDetails(project, sshKeyPath, ipAddress)
  })
