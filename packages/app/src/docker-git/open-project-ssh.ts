import { defaultTemplateConfig } from "@lib/core/domain"
import { runDockerInspectContainerRuntimeInfo } from "@lib/shell/docker"
import { buildSshCommand, connectProjectSsh, probeProjectSshReady, type ProjectItem } from "@lib/usecases/projects"
import { Effect, pipe } from "effect"

import { connectMenuProjectSshWithUp } from "./menu-api.js"

export type OpenResolvedProjectSshDeps<E, R> = {
  readonly log: (message: string) => Effect.Effect<void, E, R>
  readonly resolvePreferredItem: (item: ProjectItem) => Effect.Effect<ProjectItem | null, E, R>
  readonly probeReady: (item: ProjectItem) => Effect.Effect<boolean, E, R>
  readonly connect: (item: ProjectItem) => Effect.Effect<void, E, R>
  readonly connectWithUp: (item: ProjectItem) => Effect.Effect<void, E, R>
}

const withProjectItemIpAddress = (
  item: ProjectItem,
  ipAddress: string
): ProjectItem => ({
  ...item,
  ipAddress,
  sshCommand: buildSshCommand(
    {
      ...defaultTemplateConfig,
      containerName: item.containerName,
      serviceName: item.serviceName,
      sshUser: item.sshUser,
      sshPort: item.sshPort,
      repoUrl: item.repoUrl,
      repoRef: item.repoRef,
      targetDir: item.targetDir,
      envGlobalPath: item.envGlobalPath,
      envProjectPath: item.envProjectPath,
      codexAuthPath: item.codexAuthPath,
      codexSharedAuthPath: item.codexAuthPath,
      codexHome: item.codexHome,
      clonedOnHostname: item.clonedOnHostname
    },
    item.sshKeyPath,
    ipAddress
  )
})

const sameConnectionTarget = (left: ProjectItem, right: ProjectItem): boolean =>
  left.ipAddress === right.ipAddress &&
  left.sshPort === right.sshPort &&
  left.sshKeyPath === right.sshKeyPath &&
  left.sshUser === right.sshUser

const attemptDirectConnect = <E, R>(
  item: ProjectItem,
  deps: Pick<OpenResolvedProjectSshDeps<E, R>, "connect" | "log" | "probeReady">
): Effect.Effect<boolean, E, R> =>
  deps.probeReady(item).pipe(
    Effect.flatMap((ready) =>
      ready
        ? pipe(
          deps.log(`Opening SSH: ${item.sshCommand}`),
          Effect.zipRight(deps.connect(item)),
          Effect.as(true)
        )
        : Effect.succeed(false)
    )
  )

export const openResolvedProjectSshEffect = <E, R>(
  item: ProjectItem,
  deps: OpenResolvedProjectSshDeps<E, R>
) =>
  Effect.gen(function*(_) {
    const preferredItem = yield* _(deps.resolvePreferredItem(item))
    if (preferredItem !== null) {
      const connected = yield* _(attemptDirectConnect(preferredItem, deps))
      if (connected) {
        return
      }
    }

    const shouldRetryOriginal = preferredItem === null || !sameConnectionTarget(preferredItem, item)
    if (shouldRetryOriginal) {
      const connected = yield* _(attemptDirectConnect(item, deps))
      if (connected) {
        return
      }
    }

    yield* _(deps.log(`Opening SSH: ${item.sshCommand}`))
    yield* _(deps.connectWithUp(item))
  })

export const openResolvedProjectSsh = (item: ProjectItem) =>
  openResolvedProjectSshEffect(item, {
    log: (message) => Effect.log(message),
    resolvePreferredItem: (selected) =>
      runDockerInspectContainerRuntimeInfo(process.cwd(), selected.containerName).pipe(
        Effect.map((runtime) =>
          runtime !== null && runtime.ipAddress.length > 0
            ? withProjectItemIpAddress(selected, runtime.ipAddress)
            : null
        )
      ),
    probeReady: (selected) => probeProjectSshReady(selected),
    connect: (selected) => connectProjectSsh(selected),
    connectWithUp: (selected) => connectMenuProjectSshWithUp(selected)
  })
