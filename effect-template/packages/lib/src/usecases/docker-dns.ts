import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import { deriveDockerDnsName } from "../core/docker-network.js"
import { runDockerInspectContainerIp } from "../shell/docker.js"
import type { DockerCommandError } from "../shell/errors.js"

// CHANGE: register docker.<org>.<repo> hostname for the project
// WHY: allow accessing container services via stable DNS
// QUOTE(ТЗ): "docker.{dns}:port"
// REF: user-request-2026-01-30-dns
// SOURCE: n/a
// FORMAT THEOREM: forall h: ensure(h) -> hosts(h)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem>
// INVARIANT: adds entry once, idempotent
// COMPLEXITY: O(n) where n = |/etc/hosts|
export const ensureDockerDnsHost = (
  cwd: string,
  containerName: string,
  repoUrl: string
): Effect.Effect<
  void,
  DockerCommandError | PlatformError,
  FileSystem.FileSystem | CommandExecutor.CommandExecutor
> => {
  const addHost = Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const hostName = deriveDockerDnsName(repoUrl)
    const hostsPath = "/etc/hosts"
    const ipAddress = yield* _(runDockerInspectContainerIp(cwd, containerName))
    if (ipAddress.length === 0) {
      yield* _(Effect.logWarning(`Docker IP not available for ${containerName}; skipping DNS entry.`))
      return
    }
    const current = yield* _(fs.readFileString(hostsPath))
    if (current.includes(` ${hostName}`) || current.includes(`\t${hostName}`)) {
      return
    }
    const next = `${current.trimEnd()}\n${ipAddress} ${hostName}\n`
    yield* _(fs.writeFileString(hostsPath, next))
    yield* _(Effect.log(`DNS alias added: ${hostName} -> ${ipAddress}`))
  })

  return Effect.match(addHost, {
    onFailure: (error) =>
      Effect.logWarning(
        `Failed to update /etc/hosts for docker DNS: ${error instanceof Error ? error.message : String(error)}`
      ).pipe(Effect.asVoid),
    onSuccess: () => Effect.void
  })
}
