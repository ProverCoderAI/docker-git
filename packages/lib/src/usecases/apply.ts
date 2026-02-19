import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

import type { ApplyCommand, TemplateConfig } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { ensureDockerDaemonAccess } from "../shell/docker.js"
import type * as ShellErrors from "../shell/errors.js"
import { writeProjectFiles } from "../shell/files.js"
import { ensureCodexConfigFile } from "./auth-sync.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"

type ApplyProjectFilesError =
  | ShellErrors.ConfigNotFoundError
  | ShellErrors.ConfigDecodeError
  | ShellErrors.FileExistsError
  | PlatformError
type ApplyProjectFilesEnv = FileSystem | Path

// CHANGE: apply existing docker-git.json to managed files in an already created project
// WHY: allow updating current project/container config without creating a new project directory
// QUOTE(ТЗ): "Не создавать новый... а прямо в текущем обновить её на актуальную"
// REF: issue-72-followup-apply-current-config
// SOURCE: n/a
// FORMAT THEOREM: forall p: apply_files(p) -> files(p) = plan(read_config(p))
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, ConfigNotFoundError | ConfigDecodeError | FileExistsError | PlatformError, FileSystem | Path>
// INVARIANT: rewrites only managed files from docker-git.json
// COMPLEXITY: O(n) where n = |managed_files|
export const applyProjectFiles = (
  projectDir: string
): Effect.Effect<TemplateConfig, ApplyProjectFilesError, ApplyProjectFilesEnv> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Applying docker-git config files in ${projectDir}...`))
    const config = yield* _(readProjectConfig(projectDir))
    yield* _(writeProjectFiles(projectDir, config.template, true))
    yield* _(ensureCodexConfigFile(projectDir, config.template.codexAuthPath))
    return config.template
  })

export type ApplyProjectConfigError =
  | ApplyProjectFilesError
  | ShellErrors.DockerAccessError
  | ShellErrors.DockerCommandError
  | ShellErrors.PortProbeError

type ApplyProjectConfigEnv = ApplyProjectFilesEnv | CommandExecutor

const applyProjectWithUp = (
  projectDir: string
): Effect.Effect<TemplateConfig, ApplyProjectConfigError, ApplyProjectConfigEnv> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Applying docker-git config and refreshing container in ${projectDir}...`))
    yield* _(ensureDockerDaemonAccess(process.cwd()))
    return yield* _(runDockerComposeUpWithPortCheck(projectDir))
  })

// CHANGE: add command handler to apply docker-git config on an existing project
// WHY: update current project/container config without running create/clone again
// QUOTE(ТЗ): "Не создавать новый... а прямо в текущем обновить её на актуальную"
// REF: issue-72-followup-apply-current-config
// SOURCE: n/a
// FORMAT THEOREM: forall c: apply(c) -> updated(project(c)) && (c.runUp -> container_refreshed(c))
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, ApplyProjectConfigError, FileSystem | Path | CommandExecutor>
// INVARIANT: project path remains unchanged; command only updates managed artifacts
// COMPLEXITY: O(n) + O(command)
export const applyProjectConfig = (
  command: ApplyCommand
): Effect.Effect<TemplateConfig, ApplyProjectConfigError, ApplyProjectConfigEnv> =>
  command.runUp
    ? applyProjectWithUp(command.projectDir)
    : applyProjectFiles(command.projectDir)
