import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { CreateCommand } from "../../core/domain.js"
import type { PortProbeError } from "../../shell/errors.js"
import { loadReservedPorts, selectAvailablePort } from "../ports-reserve.js"

const maxPortAttempts = 25

export const resolveSshPort = (
  config: CreateCommand["config"],
  outDir: string
): Effect.Effect<
  CreateCommand["config"],
  PortProbeError | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const reserved = yield* _(loadReservedPorts(outDir))
    const reservedPorts = new Set(reserved.map((entry) => entry.port))
    const selected = yield* _(selectAvailablePort(config.sshPort, maxPortAttempts, reservedPorts))
    if (selected !== config.sshPort) {
      const reason = reservedPorts.has(config.sshPort)
        ? "already reserved by another docker-git project"
        : "already in use"
      yield* _(
        Effect.logWarning(
          `SSH port ${config.sshPort} is ${reason}; using ${selected} instead.`
        )
      )
    }
    return selected === config.sshPort ? config : { ...config, sshPort: selected }
  })
