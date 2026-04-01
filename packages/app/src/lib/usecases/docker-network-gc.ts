import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { defaultTemplateConfig, resolveComposeNetworkName, type TemplateConfig } from "../core/domain.js"
import {
  runDockerNetworkContainerCount,
  runDockerNetworkCreateBridge,
  runDockerNetworkCreateBridgeWithSubnet,
  runDockerNetworkExists,
  runDockerNetworkRemove
} from "../shell/docker.js"
import type { DockerCommandError } from "../shell/errors.js"

const protectedNetworkNames = new Set(["bridge", "host", "none"])

const isProtectedNetwork = (networkName: string, sharedNetworkName: string): boolean =>
  protectedNetworkNames.has(networkName) || networkName === sharedNetworkName

type Subnet24Seed = readonly [number, number, number]

const sharedNetworkFallbackSubnetSeeds: ReadonlyArray<Subnet24Seed> = [
  [10, 250, 0],
  [10, 251, 0],
  [10, 252, 0],
  [10, 253, 0],
  [172, 31, 250],
  [172, 31, 251],
  [172, 31, 252],
  [172, 31, 253],
  [192, 168, 250],
  [192, 168, 251]
]

const formatSubnet24 = ([a, b, c]: Subnet24Seed): string => `${[a, b, c, 0].join(".")}/24`

const sharedNetworkFallbackSubnets: ReadonlyArray<string> = sharedNetworkFallbackSubnetSeeds.map((seed) =>
  formatSubnet24(seed)
)

const createSharedNetworkWithSubnetFallback = (
  cwd: string,
  networkName: string
): Effect.Effect<boolean, PlatformError, CommandExecutor> =>
  Effect.gen(function*(_) {
    for (const subnet of sharedNetworkFallbackSubnets) {
      const created = yield* _(
        runDockerNetworkCreateBridgeWithSubnet(cwd, networkName, subnet).pipe(
          Effect.as(true),
          Effect.catchTag("DockerCommandError", (error) =>
            Effect.logWarning(
              `Shared network create fallback failed (${networkName}, subnet ${subnet}, exit ${error.exitCode}); trying next subnet.`
            ).pipe(Effect.as(false)))
        )
      )
      if (created) {
        yield* _(Effect.log(`Created shared Docker network ${networkName} with subnet ${subnet}.`))
        return true
      }
    }
    return false
  })

const ensureSharedNetworkExists = (
  cwd: string,
  networkName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor> =>
  runDockerNetworkCreateBridge(cwd, networkName).pipe(
    Effect.catchTag("DockerCommandError", (error) =>
      createSharedNetworkWithSubnetFallback(cwd, networkName).pipe(
        Effect.flatMap((created) => (created ? Effect.void : Effect.fail(error)))
      ))
  )

// CHANGE: ensure shared docker network exists before compose up
// WHY: avoid compose failures when using `external: true` shared network mode
// QUOTE(ТЗ): "Что бы текущие проекты не ложились"
// REF: user-request-2026-02-20-network-shared
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: mode(cfg)="shared" -> exists(network(cfg))
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: no-op for project-scoped network mode
// COMPLEXITY: O(command)
export const ensureComposeNetworkReady = (
  cwd: string,
  template: Pick<TemplateConfig, "serviceName" | "dockerNetworkMode" | "dockerSharedNetworkName">
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor> => {
  if (template.dockerNetworkMode !== "shared") {
    return Effect.void
  }

  const networkName = resolveComposeNetworkName(template)
  return runDockerNetworkExists(cwd, networkName).pipe(
    Effect.flatMap((exists) =>
      exists
        ? Effect.void
        : Effect.log(`Creating shared Docker network: ${networkName}`).pipe(
          Effect.zipRight(ensureSharedNetworkExists(cwd, networkName))
        )
    )
  )
}

const gcNetworkByName = (
  cwd: string,
  networkName: string,
  sharedNetworkName: string
): Effect.Effect<void, never, CommandExecutor> => {
  if (isProtectedNetwork(networkName, sharedNetworkName)) {
    return Effect.void
  }

  return runDockerNetworkContainerCount(cwd, networkName).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.logWarning(
          `Skipping network GC for ${networkName}: ${error instanceof Error ? error.message : String(error)}`
        ),
      onSuccess: (containerCount) => {
        if (containerCount > 0) {
          return Effect.void
        }
        return runDockerNetworkRemove(cwd, networkName).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.logWarning(
                `Failed to remove detached network ${networkName}: ${
                  error instanceof Error ? error.message : String(error)
                }`
              ),
            onSuccess: () => Effect.log(`Removed detached docker-git network: ${networkName}`)
          })
        )
      }
    }),
    Effect.asVoid
  )
}

// CHANGE: garbage-collect detached project-scoped docker-git networks
// WHY: prevent stale networks from exhausting Docker address pools
// QUOTE(ТЗ): "убирать мусорные сети автоматически"
// REF: user-request-2026-02-20-network-gc
// SOURCE: n/a
// FORMAT THEOREM: ∀n: detached(n) -> eventually_removed(n)
// PURITY: SHELL
// EFFECT: Effect<void, never, CommandExecutor>
// INVARIANT: shared/system networks are never removed
// COMPLEXITY: O(command)
export const gcProjectNetworkByTemplate = (
  cwd: string,
  template: Pick<TemplateConfig, "serviceName" | "dockerNetworkMode" | "dockerSharedNetworkName">
): Effect.Effect<void, never, CommandExecutor> => {
  if (template.dockerNetworkMode !== "project") {
    return Effect.void
  }

  return gcNetworkByName(cwd, resolveComposeNetworkName(template), template.dockerSharedNetworkName)
}

// CHANGE: best-effort cleanup of legacy project-scoped network by service name
// WHY: delete flow may run after project files are gone, so we fallback to naming convention
// QUOTE(ТЗ): "Только так что бы текущие проекты не ложились"
// REF: user-request-2026-02-20-network-gc
// SOURCE: n/a
// FORMAT THEOREM: ∀s: gc(service=s) -> removes_only(detached_network(s))
// PURITY: SHELL
// EFFECT: Effect<void, never, CommandExecutor>
// INVARIANT: never removes bridge/host/none/shared network names
// COMPLEXITY: O(command)
export const gcProjectNetworkByServiceName = (
  cwd: string,
  serviceName: string,
  sharedNetworkName: string = defaultTemplateConfig.dockerSharedNetworkName
): Effect.Effect<void, never, CommandExecutor> => gcNetworkByName(cwd, `${serviceName}-net`, sharedNetworkName)
