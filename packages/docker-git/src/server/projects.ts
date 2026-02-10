import { Effect, pipe } from "effect"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"

import type { ProjectConfig } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import type { ConfigDecodeError, ConfigNotFoundError } from "../shell/errors.js"
import type { ProjectIssue, ProjectSummary, ProjectsIndex } from "./core/domain.js"
import { buildSshCommand, resolveSshHost } from "./core/domain.js"
import { ProjectNotFoundError } from "./errors.js"

type ScanResult =
  | { readonly _tag: "Project"; readonly summary: ProjectSummary }
  | { readonly _tag: "Issue"; readonly issue: ProjectIssue }
  | { readonly _tag: "Skip" }

const makeSkip = (): ScanResult => ({ _tag: "Skip" })

const makeIssue = (issue: ProjectIssue): ScanResult => ({ _tag: "Issue", issue })

const makeProject = (summary: ProjectSummary): ScanResult => ({ _tag: "Project", summary })

const resolvePath = (path: Path.Path, baseDir: string, inputPath: string): string =>
  path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath)

const findExistingUpwards = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  startDir: string,
  fileName: string,
  maxDepth: number
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    let current = startDir
    let depth = 0

    while (true) {
      const candidate = path.join(current, fileName)
      const exists = yield* _(fs.exists(candidate))
      if (exists) {
        return candidate
      }

      const parent = path.dirname(current)
      if (parent === current || depth >= maxDepth) {
        return null
      }

      current = parent
      depth += 1
    }
  })

const findSshPrivateKey = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const envPath = process.env["DOCKER_GIT_SSH_KEY"]?.trim()
    if (envPath && envPath.length > 0) {
      const exists = yield* _(fs.exists(envPath))
      if (exists) {
        return envPath
      }
    }

    const devKey = yield* _(findExistingUpwards(fs, path, cwd, "dev_ssh_key", 6))
    if (devKey !== null) {
      return devKey
    }

    const home = process.env["HOME"]?.trim()
    if (home && home.length > 0) {
      const ed25519 = path.join(home, ".ssh", "id_ed25519")
      const edExists = yield* _(fs.exists(ed25519))
      if (edExists) {
        return ed25519
      }

      const rsa = path.join(home, ".ssh", "id_rsa")
      const rsaExists = yield* _(fs.exists(rsa))
      if (rsaExists) {
        return rsa
      }
    }

    return null
  })

const toProjectSummary = (
  dir: string,
  id: string,
  config: ProjectConfig,
  sshHost: string,
  sshKeyPath: string | null
): Effect.Effect<ProjectSummary, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const authorizedKeysPath = resolvePath(path, dir, config.template.authorizedKeysPath)
    const codexAuthPath = resolvePath(path, dir, config.template.codexAuthPath)
    const envGlobalPath = resolvePath(path, dir, config.template.envGlobalPath)
    const envProjectPath = resolvePath(path, dir, config.template.envProjectPath)
    const authorizedKeysExists = yield* _(fs.exists(authorizedKeysPath))
    const envGlobalExists = yield* _(fs.exists(envGlobalPath))
    const envProjectExists = yield* _(fs.exists(envProjectPath))
    const sshCommand = buildSshCommand({
      sshUser: config.template.sshUser,
      sshPort: config.template.sshPort,
      sshHost,
      sshKeyPath
    })

    return {
      id,
      directory: dir,
      repoUrl: config.template.repoUrl,
      repoRef: config.template.repoRef,
      sshUser: config.template.sshUser,
      sshPort: config.template.sshPort,
      sshHost,
      sshCommand,
      sshKeyPath,
      containerName: config.template.containerName,
      serviceName: config.template.serviceName,
      targetDir: config.template.targetDir,
      volumeName: config.template.volumeName,
      authorizedKeysPath,
      authorizedKeysExists,
      envGlobalPath,
      envGlobalExists,
      envProjectPath,
      envProjectExists,
      codexAuthPath,
      codexHome: config.template.codexHome
    }
  })

const toIssue = (
  id: string,
  error: { readonly _tag: string; readonly path: string; readonly message?: string }
): ProjectIssue =>
  error._tag === "ConfigNotFoundError"
    ? {
        _tag: "ConfigNotFound",
        id,
        path: error.path
      }
    : {
        _tag: "ConfigDecode",
        id,
        path: error.path,
        message: error.message ?? "Invalid config"
      }

const scanEntry = (
  root: string,
  id: string,
  sshHost: string,
  sshKeyPath: string | null
): Effect.Effect<
  ScanResult,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const dir = path.join(root, id)
    const info = yield* _(fs.stat(dir))
    if (info.type !== "Directory") {
      return makeSkip()
    }

    return yield* _(
      pipe(
        readProjectConfig(dir),
        Effect.flatMap((config) =>
          pipe(
            toProjectSummary(dir, id, config, sshHost, sshKeyPath),
            Effect.map((summary) => makeProject(summary))
          )
        ),
        Effect.catchAll((error) =>
          error._tag === "ConfigNotFoundError" || error._tag === "ConfigDecodeError"
            ? Effect.succeed(makeIssue(toIssue(id, error)))
            : Effect.fail(error)
        )
      )
    )
  })

// CHANGE: scan project folders for docker-git configs
// WHY: build the web dashboard data from generated docker-git projects
// QUOTE(ТЗ): "Будет список докер образом"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall root: scan(root) -> projects(root) + issues(root)
// PURITY: SHELL
// EFFECT: Effect<ProjectsIndex, PlatformError, FileSystem | Path>
// INVARIANT: returns absolute root path
// COMPLEXITY: O(n) where n = |entries|
export const scanProjects = (
  projectsRoot: string,
  cwd: string
): Effect.Effect<ProjectsIndex, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedRoot = path.resolve(projectsRoot)
    const rootExists = yield* _(fs.exists(resolvedRoot))

    if (!rootExists) {
      return {
        root: resolvedRoot,
        exists: false,
        projects: [],
        issues: []
      }
    }

    const entries = yield* _(fs.readDirectory(resolvedRoot))
    const sshHost = resolveSshHost(process.env)
    const sshKeyPath = yield* _(findSshPrivateKey(fs, path, cwd))

    const results = yield* _(
      Effect.forEach(entries, (entry) =>
        scanEntry(resolvedRoot, entry, sshHost, sshKeyPath)
      )
    )

    const projects: Array<ProjectSummary> = []
    const issues: Array<ProjectIssue> = []

    for (const result of results) {
      if (result._tag === "Project") {
        projects.push(result.summary)
      } else if (result._tag === "Issue") {
        issues.push(result.issue)
      }
    }

    return {
      root: resolvedRoot,
      exists: true,
      projects,
      issues
    }
  })

// CHANGE: load a single docker-git project summary
// WHY: provide a typed API for per-project actions
// QUOTE(ТЗ): "вижу всю инфу по ним"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall id: exists(id) -> summary(id)
// PURITY: SHELL
// EFFECT: Effect<ProjectSummary, ProjectNotFoundError | ConfigNotFoundError | ConfigDecodeError | PlatformError, FileSystem | Path>
// INVARIANT: returns absolute directory paths
// COMPLEXITY: O(1)
export const loadProject = (
  projectsRoot: string,
  id: string,
  cwd: string
): Effect.Effect<
  ProjectSummary,
  ProjectNotFoundError | ConfigNotFoundError | ConfigDecodeError | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedRoot = path.resolve(projectsRoot)
    const dir = path.join(resolvedRoot, id)
    const exists = yield* _(fs.exists(dir))

    if (!exists) {
      return yield* _(Effect.fail(new ProjectNotFoundError({ id, root: resolvedRoot })))
    }

    const info = yield* _(fs.stat(dir))
    if (info.type !== "Directory") {
      return yield* _(Effect.fail(new ProjectNotFoundError({ id, root: resolvedRoot })))
    }

    const sshHost = resolveSshHost(process.env)
    const sshKeyPath = yield* _(findSshPrivateKey(fs, path, cwd))
    const config = yield* _(readProjectConfig(dir))

    return yield* _(toProjectSummary(dir, id, config, sshHost, sshKeyPath))
  })
