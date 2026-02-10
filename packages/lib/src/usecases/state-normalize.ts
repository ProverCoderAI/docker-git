import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { TemplateConfig } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { writeProjectFiles } from "../shell/files.js"

const isDockerGitConfig = (entry: string): boolean => entry.endsWith("docker-git.json")

const shouldSkipDir = (entry: string): boolean => entry === ".git" || entry === ".orch"

const toPosixPath = (value: string): string => value.replaceAll("\\", "/")

const isLegacyDockerGitRelativePath = (value: string): boolean => {
  const normalized = value.replaceAll("\\", "/").trim()
  return normalized === ".docker-git" ||
    normalized === "./.docker-git" ||
    normalized.startsWith(".docker-git/") ||
    normalized.startsWith("./.docker-git/")
}

const shouldNormalizePath = (path: Path.Path, value: string): boolean =>
  path.isAbsolute(value) || isLegacyDockerGitRelativePath(value)

const normalizeTemplateConfig = (
  path: Path.Path,
  projectsRoot: string,
  projectDir: string,
  template: TemplateConfig
): TemplateConfig | null => {
  const needs =
    shouldNormalizePath(path, template.authorizedKeysPath) ||
    shouldNormalizePath(path, template.envGlobalPath) ||
    shouldNormalizePath(path, template.envProjectPath) ||
    shouldNormalizePath(path, template.codexAuthPath) ||
    shouldNormalizePath(path, template.codexSharedAuthPath)

  if (!needs) {
    return null
  }

  // The state repo is shared across machines, so never persist absolute host paths in tracked files.
  const authorizedKeysAbs = path.join(projectsRoot, "authorized_keys")
  const authorizedKeysRel = toPosixPath(path.relative(projectDir, authorizedKeysAbs))

  const envGlobalPath = "./.orch/env/global.env"
  const envProjectPath = "./.orch/env/project.env"
  const codexAuthPath = "./.orch/auth/codex"
  const codexSharedAbs = path.join(projectsRoot, ".orch", "auth", "codex")
  const codexSharedRel = toPosixPath(path.relative(projectDir, codexSharedAbs))

  return {
    ...template,
    authorizedKeysPath: authorizedKeysRel.length > 0 ? authorizedKeysRel : "./authorized_keys",
    envGlobalPath: envGlobalPath,
    envProjectPath: envProjectPath,
    codexAuthPath: codexAuthPath,
    codexSharedAuthPath: codexSharedRel.length > 0 ? codexSharedRel : "./.orch/auth/codex"
  }
}

const findProjectConfigPaths = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  projectsRoot: string
): Effect.Effect<ReadonlyArray<string>, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(projectsRoot))
    if (!exists) {
      return []
    }

    // Avoid traversing git metadata (projectsRoot can itself be a git repo).
    const results: Array<string> = []
    const stack: Array<string> = [projectsRoot]
    while (stack.length > 0) {
      const dir = stack.pop()
      if (dir === undefined) {
        break
      }
      const entries = yield* _(fs.readDirectory(dir))
      for (const entry of entries) {
        if (shouldSkipDir(entry)) {
          continue
        }
        const resolved = path.join(dir, entry)
        const info = yield* _(fs.stat(resolved))
        if (info.type === "Directory") {
          stack.push(resolved)
        } else if (info.type === "File" && isDockerGitConfig(entry)) {
          results.push(resolved)
        }
      }
    }
    return results
  })

// CHANGE: normalize legacy docker-git project files inside the git-synced state repo
// WHY: state is stored in git and must be portable across machines/OSes (no absolute host paths)
// QUOTE(ТЗ): "в них не должно быть зарадкожено полных путей типо /home/dev" / "контейнеры должны одинаково ставится на разные ОС"
// REF: user-request-2026-02-09-state-normalize-paths
// SOURCE: n/a
// FORMAT THEOREM: forall p in projects: normalize(p) -> portable(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: preserves repo identity (repoUrl/repoRef/containerName/ports); only rewrites host-path fields
// COMPLEXITY: O(n) where n = |projects|
export const normalizeLegacyStateProjects = (
  projectsRoot: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)

    const root = path.resolve(projectsRoot)
    const configPaths = yield* _(findProjectConfigPaths(fs, path, root))
    if (configPaths.length === 0) {
      return
    }

    let updated = 0
    for (const configPath of configPaths) {
      const projectDir = path.dirname(configPath)
      const config = yield* _(
        readProjectConfig(projectDir).pipe(
          Effect.catchAll(() => Effect.succeed(null))
        )
      )
      if (config === null) {
        continue
      }

      const normalized = normalizeTemplateConfig(path, root, projectDir, config.template)
      if (normalized === null) {
        continue
      }

      yield* _(
        writeProjectFiles(projectDir, normalized, true).pipe(
          Effect.catchTag(
            "FileExistsError",
            (error) =>
              Effect.logWarning(
                `Skipping normalization for ${projectDir}: ${error.path} already exists`
              ).pipe(Effect.zipRight(Effect.succeed<ReadonlyArray<string>>([])))
          ),
          Effect.asVoid
        )
      )
      updated += 1
    }

    if (updated > 0) {
      yield* _(Effect.log(`Normalized ${updated} docker-git project(s) in state repo.`))
    }
  }).pipe(Effect.asVoid)
