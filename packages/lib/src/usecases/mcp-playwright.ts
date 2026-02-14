import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

import type { McpPlaywrightUpCommand, TemplateConfig } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { ensureDockerDaemonAccess } from "../shell/docker.js"
import type {
  ConfigDecodeError,
  ConfigNotFoundError,
  DockerAccessError,
  DockerCommandError,
  FileExistsError,
  PortProbeError
} from "../shell/errors.js"
import { writeProjectFiles } from "../shell/files.js"
import { ensureCodexConfigFile } from "./auth-sync.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"

type McpPlaywrightFilesError = ConfigNotFoundError | ConfigDecodeError | FileExistsError | PlatformError
type McpPlaywrightFilesEnv = FileSystem | Path

const enableInTemplate = (template: TemplateConfig): TemplateConfig => ({
  ...template,
  enableMcpPlaywright: true
})

// CHANGE: enable Playwright MCP in an existing docker-git project directory (files only)
// WHY: allow adding the browser sidecar + MCP server config without wiping env or volumes
// QUOTE(ТЗ): "Добавить возможность поднимать MCP Playrgiht в контейнере который уже создан"
// REF: issue-29
// SOURCE: n/a
// FORMAT THEOREM: forall p: enable(p) -> template(p).enableMcpPlaywright = true
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, ConfigNotFoundError | ConfigDecodeError | FileExistsError | PlatformError, FileSystem | Path>
// INVARIANT: does not rewrite .orch/env/project.env (only managed templates + docker-git.json)
// COMPLEXITY: O(n) where n = |managed_files|
export const enableMcpPlaywrightProjectFiles = (
  projectDir: string
): Effect.Effect<TemplateConfig, McpPlaywrightFilesError, McpPlaywrightFilesEnv> =>
  Effect.gen(function*(_) {
    const config = yield* _(readProjectConfig(projectDir))
    const alreadyEnabled = config.template.enableMcpPlaywright
    const updated = alreadyEnabled ? config.template : enableInTemplate(config.template)

    yield* _(
      alreadyEnabled
        ? Effect.log("Playwright MCP is already enabled for this project.")
        : Effect.log("Enabling Playwright MCP for this project (templates only)...")
    )

    yield* _(writeProjectFiles(projectDir, updated, true))
    yield* _(ensureCodexConfigFile(projectDir, updated.codexAuthPath))

    return updated
  })

export type McpPlaywrightUpError =
  | McpPlaywrightFilesError
  | DockerAccessError
  | DockerCommandError
  | PortProbeError

type McpPlaywrightUpEnv = McpPlaywrightFilesEnv | CommandExecutor

// CHANGE: enable Playwright MCP in an existing project dir and bring docker compose up
// WHY: upgrade already created containers to support browser automation without forcing full recreation flows
// QUOTE(ТЗ): "Добавить возможность поднимать MCP Playrgiht в контейнере который уже создан"
// REF: issue-29
// SOURCE: n/a
// FORMAT THEOREM: forall p: up(p) -> running(p-browser) OR docker_error
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, McpPlaywrightUpError, FileSystem | Path | CommandExecutor>
// INVARIANT: volumes are preserved (no docker compose down -v)
// COMPLEXITY: O(command)
export const mcpPlaywrightUp = (
  command: McpPlaywrightUpCommand
): Effect.Effect<TemplateConfig, McpPlaywrightUpError, McpPlaywrightUpEnv> =>
  Effect.gen(function*(_) {
    const updated = yield* _(enableMcpPlaywrightProjectFiles(command.projectDir))

    if (!command.runUp) {
      return updated
    }

    yield* _(ensureDockerDaemonAccess(process.cwd()))
    return yield* _(runDockerComposeUpWithPortCheck(command.projectDir))
  })
