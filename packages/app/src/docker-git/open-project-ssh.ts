import { defaultTemplateConfig } from "@lib/core/domain"
import { buildSshCommand, type ProjectItem } from "@lib/usecases/projects"
import { Effect } from "effect"

export type OpenResolvedProjectSshDeps<E, R> = {
  readonly log: (message: string) => Effect.Effect<void, E, R>
  readonly resolvePreferredItem: (item: ProjectItem) => Effect.Effect<ProjectItem | null, E, R>
  readonly probeReady: (item: ProjectItem) => Effect.Effect<boolean, E, R>
  readonly connect: (item: ProjectItem) => Effect.Effect<void, E, R>
  readonly connectWithUp: (item: ProjectItem) => Effect.Effect<void, E, R>
}

export const withProjectItemIpAddress = (
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
        ? Effect.all([
          deps.log(`Opening SSH: ${item.sshCommand}`),
          deps.connect(item)
        ]).pipe(Effect.as(true))
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
