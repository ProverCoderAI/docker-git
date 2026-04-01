import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

import { type ApplyCommand, type TemplateConfig } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { ensureDockerDaemonAccess } from "../shell/docker.js"
import type * as ShellErrors from "../shell/errors.js"
import { writeProjectFiles } from "../shell/files.js"
import { resolveBaseDir } from "../shell/paths.js"
import { applyTemplateOverrides, hasApplyOverrides } from "./apply-overrides.js"
import {
  collectRemoteIdentities,
  gitCapture,
  listProjectCandidates,
  selectCandidateProjectDir
} from "./apply-project-discovery.js"
import { ensureClaudeAuthSeedFromHome, ensureCodexConfigFile } from "./auth-sync.js"
import { defaultProjectsRoot, findExistingUpwards } from "./path-helpers.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"
import { resolveTemplateResourceLimits } from "./resource-limits.js"

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
  projectDir: string,
  command?: ApplyCommand
): Effect.Effect<TemplateConfig, ApplyProjectFilesError, ApplyProjectFilesEnv> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Applying docker-git config files in ${projectDir}...`))
    const config = yield* _(readProjectConfig(projectDir))
    const resolvedTemplate = yield* _(
      resolveTemplateResourceLimits(applyTemplateOverrides(config.template, command))
    )
    yield* _(writeProjectFiles(projectDir, resolvedTemplate, true))
    yield* _(ensureCodexConfigFile(projectDir, resolvedTemplate.codexAuthPath))
    yield* _(ensureClaudeAuthSeedFromHome(defaultProjectsRoot(projectDir), ".orch/auth/claude"))
    return resolvedTemplate
  })

export type ApplyProjectConfigError =
  | ApplyProjectFilesError
  | ShellErrors.DockerAccessError
  | ShellErrors.DockerCommandError
  | ShellErrors.PortProbeError

type ApplyProjectConfigEnv = ApplyProjectFilesEnv | CommandExecutor

const gitBranchDetached = "HEAD"
const maxLocalConfigSearchDepth = 6
const nullString = (): string | null => null

const resolveFromCurrentTree = (): Effect.Effect<string | null, PlatformError, ApplyProjectFilesEnv> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir("."))
    const configPath = yield* _(
      findExistingUpwards(fs, path, resolved, "docker-git.json", maxLocalConfigSearchDepth).pipe(
        Effect.match({
          onFailure: nullString,
          onSuccess: (value) => value
        })
      )
    )
    return configPath === null ? null : path.dirname(configPath)
  })

const normalizeBranch = (branch: string | null): string | null => {
  const normalized = branch?.trim() ?? ""
  if (normalized.length === 0 || normalized === gitBranchDetached) {
    return null
  }
  return normalized
}

const resolveFromCurrentRepository = (): Effect.Effect<string | null, PlatformError, ApplyProjectConfigEnv> =>
  Effect.gen(function*(_) {
    const cwd = process.cwd()
    const repoRoot = yield* _(gitCapture(cwd, ["rev-parse", "--show-toplevel"]))
    if (repoRoot === null) {
      return null
    }

    const remoteIdentities = yield* _(collectRemoteIdentities(repoRoot))
    if (remoteIdentities.length === 0) {
      return null
    }

    const branch = normalizeBranch(yield* _(gitCapture(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])))
    const projectsRoot = defaultProjectsRoot(cwd)
    const candidates = yield* _(listProjectCandidates(projectsRoot))
    if (candidates.length === 0) {
      return null
    }

    return selectCandidateProjectDir(remoteIdentities, branch, candidates)
  })

const resolveImplicitApplyProjectDir = (): Effect.Effect<string | null, PlatformError, ApplyProjectConfigEnv> =>
  Effect.gen(function*(_) {
    const localProjectDir = yield* _(resolveFromCurrentTree())
    if (localProjectDir !== null) {
      return localProjectDir
    }
    return yield* _(resolveFromCurrentRepository())
  })

const runApplyForProjectDir = (
  projectDir: string,
  command: ApplyCommand
): Effect.Effect<TemplateConfig, ApplyProjectConfigError, ApplyProjectConfigEnv> =>
  command.runUp ? applyProjectWithUp(projectDir, command) : applyProjectFiles(projectDir, command)

const applyProjectWithUp = (
  projectDir: string,
  command: ApplyCommand
): Effect.Effect<TemplateConfig, ApplyProjectConfigError, ApplyProjectConfigEnv> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Applying docker-git config and refreshing container in ${projectDir}...`))
    yield* _(ensureDockerDaemonAccess(process.cwd()))
    yield* _(ensureClaudeAuthSeedFromHome(defaultProjectsRoot(projectDir), ".orch/auth/claude"))
    if (hasApplyOverrides(command)) {
      yield* _(applyProjectFiles(projectDir, command))
    }
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
  runApplyForProjectDir(command.projectDir, command).pipe(
    Effect.catchTag("ConfigNotFoundError", (error) =>
      command.projectDir === "."
        ? Effect.gen(function*(_) {
          const inferredProjectDir = yield* _(resolveImplicitApplyProjectDir())
          if (inferredProjectDir === null) {
            return yield* _(Effect.fail(error))
          }
          yield* _(Effect.log(`Auto-resolved docker-git project directory: ${inferredProjectDir}`))
          return yield* _(runApplyForProjectDir(inferredProjectDir, command))
        })
        : Effect.fail(error))
  )
