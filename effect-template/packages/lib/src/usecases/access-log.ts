import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import { deriveDockerDnsName } from "../core/docker-network.js"
import type { CreateCommand } from "../core/domain.js"
import { runDockerInspectContainerIp } from "../shell/docker.js"
import type { DockerCommandError } from "../shell/errors.js"
import { ensureDockerDnsHost } from "./docker-dns.js"

// CHANGE: log docker DNS alias for the created project
// WHY: surface the hostname users can use for container services
// QUOTE(ТЗ): "пусть ещё и отображает домен через который к нему можно обратиться"
// REF: user-request-2026-01-30-dns-log
// SOURCE: n/a
// FORMAT THEOREM: forall cfg: log(cfg) -> dns_alias(cfg)
// PURITY: CORE
// EFFECT: Effect<void, never, never>
// INVARIANT: hostname is deterministic for repoUrl
// COMPLEXITY: O(1)
export const logDockerDnsAccess = (config: CreateCommand["config"]): Effect.Effect<void> =>
  Effect.log(`Docker DNS: ${deriveDockerDnsName(config.repoUrl)}`)

// CHANGE: log container IP for direct access
// WHY: allow users to access services without host port mappings
// QUOTE(ТЗ): "Пусть будет обращение через IP контейнера"
// REF: user-request-2026-02-01-ip-access
// SOURCE: n/a
// FORMAT THEOREM: forall cfg: ip(cfg) -> reachable(ip, port)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: logs only if IP is available
// COMPLEXITY: O(1)
export const logContainerIpAccess = (
  cwd: string,
  config: CreateCommand["config"]
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const ipAddress = yield* _(runDockerInspectContainerIp(cwd, config.containerName))
    if (ipAddress.length === 0) {
      yield* _(Effect.logWarning(`Container IP not available: ${config.containerName}`))
      return
    }
    yield* _(Effect.log(`Container IP: ${ipAddress}`))
    yield* _(Effect.log(`Use: http://${ipAddress}:<port>`))
  })

// CHANGE: ensure docker DNS entry and log access info together
// WHY: keep create flow compact without losing access hints
// QUOTE(ТЗ): "Он должен сразу показать доступы"
// REF: user-request-2026-02-05-access-info
// SOURCE: n/a
// FORMAT THEOREM: ∀c: up(c) → dns(c) ∧ ip(c)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, FileSystem | CommandExecutor>
// INVARIANT: DNS entry is idempotent
// COMPLEXITY: O(1)
export const logDockerAccessInfo = (
  cwd: string,
  config: CreateCommand["config"]
): Effect.Effect<
  void,
  DockerCommandError | PlatformError,
  FileSystem.FileSystem | CommandExecutor.CommandExecutor
> =>
  ensureDockerDnsHost(cwd, config.containerName, config.repoUrl).pipe(
    Effect.zipRight(logDockerDnsAccess(config)),
    Effect.zipRight(logContainerIpAccess(cwd, config))
  )
