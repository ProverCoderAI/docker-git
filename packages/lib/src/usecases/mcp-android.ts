import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

import type { McpAndroidUpCommand, TemplateConfig } from "../core/domain.js"
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

type McpAndroidFilesError = ConfigNotFoundError | ConfigDecodeError | FileExistsError | PlatformError
type McpAndroidFilesEnv = FileSystem | Path

const enableInTemplate = (template: TemplateConfig): TemplateConfig => ({
  ...template,
  enableMcpAndroid: true
})

// CHANGE: enable Android MCP in an existing docker-git project directory (files only)
// WHY: allow adding the Android emulator sidecar + android-connection MCP config without wiping env or volumes
// QUOTE(ТЗ): "Подключить mcp-android так же как работает MCP PLAYRIGHT"
// REF: issue-436
// SOURCE: n/a
// FORMAT THEOREM: forall p: enable(p) -> template(p).enableMcpAndroid = true
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, ConfigNotFoundError | ConfigDecodeError | FileExistsError | PlatformError, FileSystem | Path>
// INVARIANT: does not rewrite .orch/env/project.env (only managed templates + docker-git.json)
// COMPLEXITY: O(n) where n = |managed_files|
export const enableMcpAndroidProjectFiles = (
  projectDir: string
): Effect.Effect<TemplateConfig, McpAndroidFilesError, McpAndroidFilesEnv> =>
  Effect.gen(function*(_) {
    const config = yield* _(readProjectConfig(projectDir))
    const wasAlreadyEnabled = config.template.enableMcpAndroid
    const updated = wasAlreadyEnabled ? config.template : enableInTemplate(config.template)

    yield* _(
      wasAlreadyEnabled
        ? Effect.log("Android MCP is already enabled for this project.")
        : Effect.log("Enabling Android MCP for this project (templates only)...")
    )

    yield* _(writeProjectFiles(projectDir, updated, true))
    yield* _(ensureCodexConfigFile(projectDir, updated.codexAuthPath))

    return updated
  })

export type McpAndroidUpError =
  | McpAndroidFilesError
  | DockerAccessError
  | DockerCommandError
  | PortProbeError

type McpAndroidUpEnv = McpAndroidFilesEnv | CommandExecutor

// CHANGE: enable Android MCP in an existing project dir and bring docker compose up
// WHY: upgrade already created containers to support Android automation without forcing full recreation flows
// QUOTE(ТЗ): "Подключить mcp-android так же как работает MCP PLAYRIGHT"
// REF: issue-436
// SOURCE: n/a
// FORMAT THEOREM: forall p: up(p) -> running(p-android) OR docker_error
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, McpAndroidUpError, FileSystem | Path | CommandExecutor>
// INVARIANT: volumes are preserved (no docker compose down -v)
// COMPLEXITY: O(command)
export const mcpAndroidUp = (
  command: McpAndroidUpCommand
): Effect.Effect<TemplateConfig, McpAndroidUpError, McpAndroidUpEnv> =>
  Effect.gen(function*(_) {
    const updated = yield* _(enableMcpAndroidProjectFiles(command.projectDir))

    if (!command.runUp) {
      return updated
    }

    yield* _(ensureDockerDaemonAccess(command.projectDir))
    return yield* _(runDockerComposeUpWithPortCheck(command.projectDir))
  })
