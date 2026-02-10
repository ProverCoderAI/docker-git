import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

import type { ProjectConfig, TemplateConfig } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import {
  runDockerComposePsFormatted,
  runDockerComposeUp,
  runDockerInspectContainerBridgeIp,
  runDockerNetworkConnectBridge
} from "../shell/docker.js"
import type {
  ConfigDecodeError,
  ConfigNotFoundError,
  DockerCommandError,
  FileExistsError,
  PortProbeError
} from "../shell/errors.js"
import { writeProjectFiles } from "../shell/files.js"
import { ensureCodexConfigFile } from "./auth-sync.js"
import { loadReservedPorts, selectAvailablePort } from "./ports-reserve.js"
import { parseComposePsOutput } from "./projects-core.js"

const maxPortAttempts = 25

// CHANGE: update template port when the preferred SSH port is reserved or busy
// WHY: keep each project on a unique port even across restarts
// QUOTE(ТЗ): "Почему контейнер пытается подниматься на существующий порт?"
// REF: user-request-2026-02-05-port-conflict
// SOURCE: n/a
// FORMAT THEOREM: ∀p: reserved(p) ∨ occupied(p) → selected(p') ∧ available(p')
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, PortProbeError | PlatformError | FileExistsError, FileSystem | Path>
// INVARIANT: config is rewritten when port changes
// COMPLEXITY: O(n) where n = maxPortAttempts
const ensureAvailableSshPort = (
  projectDir: string,
  config: ProjectConfig
): Effect.Effect<
  TemplateConfig,
  PortProbeError | PlatformError | FileExistsError,
  FileSystem | Path
> =>
  Effect.gen(function*(_) {
    const reserved = yield* _(loadReservedPorts(projectDir))
    const reservedPorts = new Set(reserved.map((entry) => entry.port))
    const selected = yield* _(selectAvailablePort(config.template.sshPort, maxPortAttempts, reservedPorts))
    if (selected === config.template.sshPort) {
      return config.template
    }
    const reason = reservedPorts.has(config.template.sshPort)
      ? "already reserved by another docker-git project"
      : "already in use"
    yield* _(
      Effect.logWarning(
        `SSH port ${config.template.sshPort} is ${reason}; using ${selected} instead.`
      )
    )
    const updatedTemplate: TemplateConfig = { ...config.template, sshPort: selected }
    return updatedTemplate
  })

// CHANGE: start docker compose with a fresh port check for existing projects
// WHY: keep "docker compose up" resilient to later port collisions
// QUOTE(ТЗ): "Почему контейнер пытается подниматься на существующий порт?"
// REF: user-request-2026-02-05-port-conflict
// SOURCE: n/a
// FORMAT THEOREM: ∀p: up(p) → available(ssh_port(p))
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, ConfigNotFoundError | ConfigDecodeError | PortProbeError | FileExistsError | DockerCommandError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: docker compose runs after port is validated
// COMPLEXITY: O(n) where n = maxPortAttempts
export const runDockerComposeUpWithPortCheck = (
  projectDir: string
): Effect.Effect<
  TemplateConfig,
  ConfigNotFoundError | ConfigDecodeError | PortProbeError | FileExistsError | DockerCommandError | PlatformError,
  FileSystem | Path | CommandExecutor
> =>
  Effect.gen(function*(_) {
    const config = yield* _(readProjectConfig(projectDir))
    const alreadyRunning = yield* _(
      runDockerComposePsFormatted(projectDir).pipe(
        Effect.map((raw) => parseComposePsOutput(raw)),
        Effect.map((rows) => rows.length > 0)
      )
    )

    // Avoid port churn when the project's compose environment is already running.
    const updated = alreadyRunning
      ? config.template
      : yield* _(ensureAvailableSshPort(projectDir, config))
    // Keep generated templates in sync with the running CLI version.
    yield* _(writeProjectFiles(projectDir, updated, true))
    yield* _(ensureCodexConfigFile(projectDir, updated.codexAuthPath))
    yield* _(runDockerComposeUp(projectDir))

    const ensureBridgeAccess = (containerName: string) =>
      runDockerInspectContainerBridgeIp(projectDir, containerName).pipe(
        Effect.flatMap((bridgeIp) =>
          bridgeIp.length > 0
            ? Effect.void
            : runDockerNetworkConnectBridge(projectDir, containerName)
        ),
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.logWarning(
              `Failed to connect ${containerName} to bridge network: ${
                error instanceof Error ? error.message : String(error)
              }`
            ),
          onSuccess: () => Effect.void
        })
      )

    yield* _(ensureBridgeAccess(updated.containerName))
    if (updated.enableMcpPlaywright) {
      yield* _(ensureBridgeAccess(`${updated.containerName}-browser`))
    }

    return updated
  })
