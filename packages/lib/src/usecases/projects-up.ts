import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { ProjectConfig, TemplateConfig } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import {
  runDockerComposePsFormatted,
  runDockerComposeUp,
  runDockerExecExitCode,
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
import { ensureComposeNetworkReady } from "./docker-network-gc.js"
import { loadReservedPorts, selectAvailablePort } from "./ports-reserve.js"
import { parseComposePsOutput } from "./projects-core.js"
import { resolveTemplateResourceLimits } from "./resource-limits.js"
import { ensureSharedCodexVolumeReady } from "./shared-volume-seed.js"

const maxPortAttempts = 25

export type RunDockerComposeUpWithPortCheckOptions = {
  readonly buildMode?: "build" | "reuse"
  readonly waitForPostStart?: boolean
}

const syncManagedProjectFiles = (
  projectDir: string,
  template: TemplateConfig
): Effect.Effect<void, FileExistsError | PlatformError, FileSystem | Path> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Applying docker-git templates in ${projectDir} before docker compose up...`))
    yield* _(writeProjectFiles(projectDir, template, true))
    yield* _(ensureCodexConfigFile(projectDir, template.codexAuthPath))
  })

const claudeCliSelfHealScript = String.raw`set -eu
if command -v claude >/dev/null 2>&1; then
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  exit 1
fi

NPM_ROOT="$(npm root -g 2>/dev/null || true)"
CLAUDE_JS="$NPM_ROOT/@anthropic-ai/claude-code/cli.js"
if [ -z "$NPM_ROOT" ] || [ ! -f "$CLAUDE_JS" ]; then
  echo "claude cli.js not found under npm global root" >&2
  exit 1
fi

cat <<'EOF' > /usr/local/bin/claude
#!/usr/bin/env bash
set -euo pipefail

NPM_ROOT="$(npm root -g 2>/dev/null || true)"
CLAUDE_JS="$NPM_ROOT/@anthropic-ai/claude-code/cli.js"
if [[ -z "$NPM_ROOT" || ! -f "$CLAUDE_JS" ]]; then
  echo "claude: cli.js not found under npm global root" >&2
  exit 127
fi

exec node "$CLAUDE_JS" "$@"
EOF
chmod 0755 /usr/local/bin/claude || true
ln -sf /usr/local/bin/claude /usr/bin/claude || true

command -v claude >/dev/null 2>&1`

const ensureClaudeCliReady = (
  projectDir: string,
  containerName: string
): Effect.Effect<void, never, CommandExecutor> =>
  pipe(
    runDockerExecExitCode(projectDir, containerName, [
      "bash",
      "-lc",
      "command -v claude >/dev/null 2>&1"
    ]),
    Effect.flatMap((probeExitCode) => {
      if (probeExitCode === 0) {
        return Effect.void
      }

      return pipe(
        Effect.logWarning(
          `Claude CLI is missing in ${containerName}; running docker-git self-heal.`
        ),
        Effect.zipRight(
          runDockerExecExitCode(projectDir, containerName, [
            "bash",
            "-lc",
            claudeCliSelfHealScript
          ])
        ),
        Effect.flatMap((healExitCode) =>
          healExitCode === 0
            ? Effect.log(`Claude CLI self-heal completed in ${containerName}.`)
            : Effect.logWarning(
              `Claude CLI self-heal failed in ${containerName} (exit ${healExitCode}).`
            )
        ),
        Effect.asVoid
      )
    }),
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.logWarning(
          `Skipping Claude CLI self-heal check for ${containerName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      onSuccess: () => Effect.void
    })
  )

const ensureBridgeAccess = (
  projectDir: string,
  containerName: string
): Effect.Effect<void, never, CommandExecutor> =>
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

const runProjectPostStartSelfHeal = (
  projectDir: string,
  template: TemplateConfig
): Effect.Effect<void, never, CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(ensureClaudeCliReady(projectDir, template.containerName))
    yield* _(ensureBridgeAccess(projectDir, template.containerName))
    if (template.enableMcpPlaywright) {
      yield* _(ensureBridgeAccess(projectDir, `${template.containerName}-browser`))
    }
  })

const startProjectPostStartSelfHealInBackground = (
  projectDir: string,
  template: TemplateConfig
): Effect.Effect<void, never, CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log("Continuing post-start SSH self-heal in background."))
    yield* _(Effect.forkDaemon(runProjectPostStartSelfHeal(projectDir, template)))
  })

const runProjectComposeUp = (
  projectDir: string,
  buildMode: "build" | "reuse"
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor> => {
  if (buildMode === "build") {
    return runDockerComposeUp(projectDir)
  }

  return runDockerComposeUp(projectDir, { buildMode: "reuse" }).pipe(
    Effect.catchTag("DockerCommandError", () =>
      Effect.logWarning(
        `docker compose up -d failed in ${projectDir}; falling back to docker compose up -d --build.`
      ).pipe(
        Effect.zipRight(runDockerComposeUp(projectDir))
      )
    )
  )
}

// CHANGE: update template port when the preferred SSH port is reserved or busy
// WHY: keep each project on a unique port even across restarts
// QUOTE(ТЗ): "Почему контейнер пытается подниматься на существующий порт?"
// REF: user-request-2026-02-05-port-conflict
// SOURCE: n/a
// FORMAT THEOREM: ∀p: reserved(p) ∨ occupied(p) → selected(p') ∧ available(p')
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, PortProbeError | PlatformError | FileExistsError, FileSystem | Path | CommandExecutor>
// INVARIANT: config is rewritten when port changes
// COMPLEXITY: O(n) where n = maxPortAttempts
const ensureAvailableSshPort = (
  projectDir: string,
  config: ProjectConfig
): Effect.Effect<
  TemplateConfig,
  PortProbeError | PlatformError | FileExistsError,
  FileSystem | Path | CommandExecutor
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
  projectDir: string,
  options: RunDockerComposeUpWithPortCheckOptions = {}
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
    const resolvedTemplate = yield* _(resolveTemplateResourceLimits(updated))
    // Keep generated templates in sync with the running CLI version.
    yield* _(syncManagedProjectFiles(projectDir, resolvedTemplate))
    yield* _(ensureComposeNetworkReady(projectDir, resolvedTemplate))
    yield* _(ensureSharedCodexVolumeReady(projectDir, resolvedTemplate))
    yield* _(runProjectComposeUp(projectDir, options.buildMode ?? "build"))
    if (options.waitForPostStart === false) {
      yield* _(startProjectPostStartSelfHealInBackground(projectDir, resolvedTemplate))
    } else {
      yield* _(runProjectPostStartSelfHeal(projectDir, resolvedTemplate))
    }

    return resolvedTemplate
  })
