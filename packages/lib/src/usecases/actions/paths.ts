import type * as Path from "@effect/platform/Path"
import type { CreateCommand } from "../../core/domain.js"

export const resolvePathFromBase = (path: Path.Path, baseDir: string, targetPath: string): string =>
  path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath)

const toPosixPath = (value: string): string => value.replaceAll("\\", "/")

export const resolveDockerGitRootRelativePath = (
  path: Path.Path,
  projectsRoot: string,
  inputPath: string
): string => {
  if (path.isAbsolute(inputPath)) {
    return inputPath
  }
  const normalized = inputPath
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
  if (normalized === ".docker-git") {
    return projectsRoot
  }
  const prefix = ".docker-git/"
  if (normalized.startsWith(prefix)) {
    return path.join(projectsRoot, normalized.slice(prefix.length))
  }
  return inputPath
}

type ProjectConfigs = {
  readonly globalConfig: CreateCommand["config"]
  readonly projectConfig: CreateCommand["config"]
}

export const buildProjectConfigs = (
  path: Path.Path,
  baseDir: string,
  resolvedOutDir: string,
  resolvedConfig: CreateCommand["config"]
): ProjectConfigs => {
  // docker-compose resolves relative host paths from the project directory (where docker-compose.yml lives).
  // To keep generated projects portable across host OSes, we avoid embedding absolute host paths in templates.
  const relativeFromOutDir = (absolutePath: string): string => toPosixPath(path.relative(resolvedOutDir, absolutePath))

  const globalConfig = {
    ...resolvedConfig,
    dockerGitPath: resolvePathFromBase(path, baseDir, resolvedConfig.dockerGitPath),
    authorizedKeysPath: resolvePathFromBase(path, baseDir, resolvedConfig.authorizedKeysPath),
    envGlobalPath: resolvePathFromBase(path, baseDir, resolvedConfig.envGlobalPath),
    envProjectPath: resolvePathFromBase(path, baseDir, resolvedConfig.envProjectPath),
    codexAuthPath: resolvePathFromBase(path, baseDir, resolvedConfig.codexAuthPath),
    codexSharedAuthPath: resolvePathFromBase(path, baseDir, resolvedConfig.codexSharedAuthPath)
  }
  const projectConfig = {
    ...resolvedConfig,
    dockerGitPath: relativeFromOutDir(globalConfig.dockerGitPath),
    authorizedKeysPath: relativeFromOutDir(globalConfig.authorizedKeysPath),
    envGlobalPath: "./.orch/env/global.env",
    envProjectPath: path.isAbsolute(resolvedConfig.envProjectPath)
      ? relativeFromOutDir(resolvedConfig.envProjectPath)
      : toPosixPath(resolvedConfig.envProjectPath),
    // Project-local Codex state (sessions/logs/etc) is kept under .orch.
    codexAuthPath: "./.orch/auth/codex",
    // Shared credentials root is mounted separately; entrypoint links auth.json into CODEX_HOME.
    codexSharedAuthPath: relativeFromOutDir(globalConfig.codexSharedAuthPath)
  }
  return { globalConfig, projectConfig }
}
