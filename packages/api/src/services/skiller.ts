import { spawn, type ChildProcess } from "node:child_process"
import { chownSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import type { ListProjectsContext } from "@effect-template/lib/usecases/projects-list"
import { NodeContext } from "@effect/platform-node"
import type { PlatformError } from "@effect/platform/Error"
import type * as HttpServerError from "@effect/platform/HttpServerError"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import { Effect } from "effect"
import * as Stream from "effect/Stream"

import { ApiConflictError, ApiInternalError, ApiNotFoundError } from "../api/errors.js"
import {
  containerCodexSkillsPath,
  parseDockerMountLines,
  remapContainerPathToMountedHost,
  sameSkillerScope,
  skillerBrowserScopeForContainer,
  type SkillerContainerScope
} from "./skiller-core.js"
import { getProjectItemByKey } from "./projects.js"
import { getProjectTerminalSession } from "./terminal-sessions.js"

export type SkillerLaunch = {
  readonly alreadyRunning: boolean
  readonly appPath: string
  readonly logPath: string
  readonly pid: number | null
  readonly scope: SkillerContainerScope | null
  readonly startedAtIso: string
  readonly trpcBasePath: string
  readonly trpcPort: number
}

type SkillerProcess = {
  readonly appPath: string
  readonly logPath: string
  readonly process: ChildProcess
  readonly scope: SkillerContainerScope | null
  readonly startedAtIso: string
  readonly trpcBasePath: string
  readonly trpcPort: number
}

type SkillerProcessUser = {
  readonly gid: number
  readonly uid: number
}

export type SkillerRoute =
  | { readonly _tag: "App"; readonly relativePath: string; readonly sessionId: string | null }
  | { readonly _tag: "Trpc"; readonly sessionId: string | null; readonly upstreamPath: string }

type SkillerBrowserScopeSelection = {
  readonly scope: SkillerContainerScope
  readonly sessionId: string | null
}

const submoduleRelativePath = join("third_party", "skiller-desktop-skills-manager")
const launchLogPath = join(homedir(), ".docker-git", "logs", "skiller.log")
const skillerAppPath = "/api/skiller/app/"
const skillerTrpcBasePath = "/api/skiller"
const skillerPreferredTrpcPort = 17888

let currentProcess: SkillerProcess | null = null
const sessionScopes = new Map<string, SkillerContainerScope | null>()

const isRunning = (process: ChildProcess): boolean =>
  process.exitCode === null && process.signalCode === null && !process.killed

const findWorkspaceRoot = (startDir: string): string | null => {
  let current = resolve(startDir)
  for (;;) {
    if (existsSync(join(current, ".gitmodules")) && existsSync(join(current, submoduleRelativePath))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

const resolveSkillerDir = (): Effect.Effect<string, ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const root = findWorkspaceRoot(process.cwd())
    if (root === null) {
      return yield* _(Effect.fail(new ApiNotFoundError({
        message: "docker-git workspace root with Skiller submodule was not found."
      })))
    }
    const skillerDir = join(root, submoduleRelativePath)
    if (!existsSync(join(skillerDir, "package.json"))) {
      return yield* _(Effect.fail(new ApiNotFoundError({
        message: `Skiller submodule is not initialized at ${skillerDir}. Run bun run skiller:init first.`
      })))
    }
    return skillerDir
  })

const sessionSkillerAppPath = (sessionId: string): string =>
  `/api/ssh/session/${encodeURIComponent(sessionId)}/skiller/app/`

const sessionSkillerTrpcBasePath = (sessionId: string): string =>
  `/api/ssh/session/${encodeURIComponent(sessionId)}/skiller`

const toLaunch = (
  process: SkillerProcess,
  alreadyRunning: boolean,
  sessionId: string | undefined
): SkillerLaunch => ({
  alreadyRunning,
  appPath: sessionId === undefined ? process.appPath : sessionSkillerAppPath(sessionId),
  logPath: process.logPath,
  pid: process.process.pid ?? null,
  scope: process.scope,
  startedAtIso: process.startedAtIso,
  trpcBasePath: sessionId === undefined ? process.trpcBasePath : sessionSkillerTrpcBasePath(sessionId),
  trpcPort: process.trpcPort
})

const dockerCapture = (
  args: ReadonlyArray<string>,
  command: string
): Effect.Effect<string, ApiInternalError, never> =>
  runCommandCapture(
    {
      args,
      command: "docker",
      cwd: process.cwd()
    },
    [0],
    (exitCode) => new CommandFailedError({ command, exitCode })
  ).pipe(
    Effect.mapError((cause: CommandFailedError | PlatformError) =>
      new ApiInternalError({ message: `Failed to inspect Docker container for Skiller: ${command}`, cause })
    ),
    Effect.provide(NodeContext.layer)
  )

const isPortAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => {
      resolve(false)
    })
    server.once("listening", () => {
      server.close(() => {
        resolve(true)
      })
    })
    server.listen({ host: "127.0.0.1", port })
  })

const findAvailablePort = async (preferredPort: number): Promise<number> => {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available Skiller tRPC port in range ${preferredPort}-${preferredPort + 99}.`)
}

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })

const containerHomePath = (sshUser: string): string => `/home/${sshUser}`

const inspectContainerMounts = (
  containerName: string
): Effect.Effect<ReturnType<typeof parseDockerMountLines>, ApiInternalError> =>
  dockerCapture(
    [
      "inspect",
      "-f",
      String.raw`{{range .Mounts}}{{println .Source "\t" .Destination "\t" .RW}}{{end}}`,
      containerName
    ],
    "docker inspect mounts"
  ).pipe(Effect.map(parseDockerMountLines))

const requireAccessibleDirectory = (
  path: string,
  label: string
): Effect.Effect<void, ApiConflictError> =>
  Effect.try({
    catch: () => new ApiConflictError({
      message: `Skiller cannot access the selected container ${label} at ${path}. The docker-git controller must run with Docker data mounted into /var/lib/docker.`
    }),
    try: () => {
      if (!existsSync(path) || !statSync(path).isDirectory()) {
        throw new Error(`Missing directory: ${path}`)
      }
    }
  })

const resolveSkillerScope = (
  projectKey: string,
  project: ProjectItem
): Effect.Effect<SkillerContainerScope, ApiConflictError | ApiInternalError> =>
  Effect.gen(function*(_) {
    const mounts = yield* _(inspectContainerMounts(project.containerName))
    const containerHome = containerHomePath(project.sshUser)
    const containerCodexSkills = containerCodexSkillsPath(containerHome)
    const hostHomePath = remapContainerPathToMountedHost(mounts, containerHome)
    const hostCodexSkillsPath = remapContainerPathToMountedHost(mounts, containerCodexSkills)
    const hostProjectPath = remapContainerPathToMountedHost(mounts, project.targetDir)
    if (hostHomePath === null) {
      return yield* _(Effect.fail(new ApiConflictError({
        message: `Skiller cannot find a writable Docker mount for ${containerHome} in ${project.containerName}.`
      })))
    }
    if (hostCodexSkillsPath === null) {
      return yield* _(Effect.fail(new ApiConflictError({
        message: `Skiller cannot find a writable Docker mount for ${containerCodexSkills} in ${project.containerName}.`
      })))
    }
    if (hostProjectPath === null) {
      return yield* _(Effect.fail(new ApiConflictError({
        message: `Skiller cannot find a writable Docker mount for ${project.targetDir} in ${project.containerName}.`
      })))
    }
    yield* _(requireAccessibleDirectory(hostHomePath, "home volume"))
    yield* _(requireAccessibleDirectory(hostProjectPath, "project directory"))
    return {
      containerCodexSkillsPath: containerCodexSkills,
      containerHomePath: containerHome,
      containerName: project.containerName,
      containerProjectPath: project.targetDir,
      hostCodexSkillsPath,
      hostHomePath,
      hostProjectPath,
      projectId: project.projectDir,
      projectKey,
      sshUser: project.sshUser
    }
  })

const resolveRequestedSkillerScope = (
  projectKey: string | undefined
): Effect.Effect<
  SkillerContainerScope | null,
  ApiConflictError | ApiInternalError | ApiNotFoundError | PlatformError,
  ListProjectsContext
> =>
  projectKey === undefined
    ? Effect.succeed(null)
    : getProjectItemByKey(projectKey).pipe(
      Effect.flatMap((project) => resolveSkillerScope(projectKey, project))
    )

const waitForSkillerReady = (trpcPort: number): Effect.Effect<void, ApiInternalError> =>
  Effect.tryPromise({
    catch: (cause) => new ApiInternalError({
      message: "Skiller started but did not become ready.",
      cause
    }),
    try: async () => {
      const deadline = Date.now() + 180_000
      let lastError: unknown = null
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${trpcPort}/trpc/get_app_version`)
          if (response.ok) {
            return
          }
          lastError = new Error(`HTTP ${response.status}`)
        } catch (error) {
          lastError = error
        }
        await sleep(1_000)
      }
      throw lastError ?? new Error("Timed out waiting for Skiller tRPC.")
    }
  })

const launchScript = [
  "set -euo pipefail",
  "DOCKER_GIT_SKILLER_PATCH=../../patches/skiller/docker-git-browser-folder-picker.patch",
  "DOCKER_GIT_SKILLER_PATCH_MARKER=out/.docker-git-browser-folder-picker.patch",
  "if [ -f ../../scripts/skiller-apply-docker-git-patches.mjs ]; then bun ../../scripts/skiller-apply-docker-git-patches.mjs; fi",
  "if [ ! -d node_modules ]; then bun install --frozen-lockfile; fi",
  "if [ ! -f out/main/index.js ] || [ ! -f out/renderer/index.html ] || { [ -f \"$DOCKER_GIT_SKILLER_PATCH\" ] && [ ! -f \"$DOCKER_GIT_SKILLER_PATCH_MARKER\" ]; } || { [ -f \"$DOCKER_GIT_SKILLER_PATCH\" ] && [ \"$DOCKER_GIT_SKILLER_PATCH\" -nt \"$DOCKER_GIT_SKILLER_PATCH_MARKER\" ]; }; then",
  "  bun run build",
  "  mkdir -p out",
  "  touch \"$DOCKER_GIT_SKILLER_PATCH_MARKER\"",
  "fi",
  "if [ ! -e out/preload/index.js ]; then ln -sf index.mjs out/preload/index.js; fi",
  "if [ -z \"${DISPLAY:-}\" ] && command -v xvfb-run >/dev/null 2>&1; then",
  "  exec xvfb-run -a ./node_modules/electron/dist/electron --no-sandbox out/main/index.js",
  "fi",
  "exec ./node_modules/electron/dist/electron --no-sandbox out/main/index.js"
].join("\n")

const skillerHomeEnv = (
  scope: SkillerContainerScope | null
): Record<string, string> =>
  scope === null
    ? {}
    : {
      HOME: scope.hostHomePath,
      USER: scope.sshUser,
      XDG_CACHE_HOME: join(scope.hostHomePath, ".cache"),
      XDG_CONFIG_HOME: join(scope.hostHomePath, ".config"),
      XDG_DATA_HOME: join(scope.hostHomePath, ".local", "share")
    }

const scopedProcessUser = (
  scope: SkillerContainerScope | null
): SkillerProcessUser | null => {
  if (scope === null) {
    return null
  }
  const stats = statSync(scope.hostHomePath)
  return { gid: stats.gid, uid: stats.uid }
}

const ensureOwnedDirectory = (path: string, user: SkillerProcessUser): void => {
  mkdirSync(path, { recursive: true })
  const stats = statSync(path)
  if (stats.uid !== user.uid || stats.gid !== user.gid) {
    chownSync(path, user.uid, user.gid)
  }
}

const chownIfExists = (path: string, user: SkillerProcessUser): void => {
  if (existsSync(path)) {
    const stats = statSync(path)
    if (stats.uid !== user.uid || stats.gid !== user.gid) {
      chownSync(path, user.uid, user.gid)
    }
  }
}

const prepareSkillerScopeHome = (scope: SkillerContainerScope | null): SkillerProcessUser | null => {
  const processUser = scopedProcessUser(scope)
  if (scope === null || processUser === null) {
    return null
  }
  ensureOwnedDirectory(join(scope.hostHomePath, ".agents"), processUser)
  ensureOwnedDirectory(join(scope.hostHomePath, ".agents", "skills"), processUser)
  ensureOwnedDirectory(join(scope.hostHomePath, ".codex"), processUser)
  ensureOwnedDirectory(scope.hostCodexSkillsPath, processUser)
  ensureOwnedDirectory(join(scope.hostHomePath, ".config"), processUser)
  ensureOwnedDirectory(join(scope.hostHomePath, ".cache"), processUser)
  ensureOwnedDirectory(join(scope.hostHomePath, ".local", "share"), processUser)
  ensureOwnedDirectory(join(scope.hostHomePath, ".skiller"), processUser)
  chownIfExists(join(scope.hostHomePath, ".codex", "config.toml"), processUser)
  chownIfExists(join(scope.hostHomePath, ".skiller", "config.toml"), processUser)
  return processUser
}

const skillerLaunchCommand = (
  user: SkillerProcessUser | null
): readonly [string, ReadonlyArray<string>] =>
  user === null
    ? ["bash", ["-lc", launchScript]]
    : [
      "setpriv",
      [
        `--reuid=${user.uid}`,
        `--regid=${user.gid}`,
        "--clear-groups",
        "bash",
        "-lc",
        launchScript
      ]
    ]

const stopSkillerProcess = (process: SkillerProcess): void => {
  const pid = process.process.pid
  if (pid === undefined) {
    process.process.kill("SIGTERM")
    return
  }
  try {
    globalThis.process.kill(-pid, "SIGTERM")
  } catch {
    process.process.kill("SIGTERM")
  }
}

const registerSkillerProject = (
  trpcPort: number,
  scope: SkillerContainerScope | null
): Effect.Effect<void, ApiInternalError> =>
  scope === null
    ? Effect.void
    : Effect.tryPromise({
      catch: (cause) => new ApiInternalError({
        message: "Skiller started but docker-git could not register the selected project path.",
        cause
      }),
      try: async () => {
        const response = await fetch(`http://127.0.0.1:${trpcPort}/trpc/add_project`, {
          body: JSON.stringify({ path: scope.hostProjectPath }),
          headers: { "content-type": "application/json" },
          method: "POST"
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`)
        }
      }
    })

const launchSkillerProcess = (
  skillerDir: string,
  trpcPort: number,
  scope: SkillerContainerScope | null
): SkillerLaunch => {
  mkdirSync(dirname(launchLogPath), { recursive: true })
  const processUser = prepareSkillerScopeHome(scope)
  const logFd = openSync(launchLogPath, "a")
  try {
    const [command, args] = skillerLaunchCommand(processUser)
    const child = spawn(command, args, {
      cwd: skillerDir,
      detached: true,
      env: {
        ...process.env,
        AGENTSKILLS_TRPC_PORT: String(trpcPort),
        ELECTRON_ENABLE_LOGGING: "1",
        ...skillerHomeEnv(scope)
      },
      stdio: ["ignore", logFd, logFd]
    })
    const startedAtIso = new Date().toISOString()
    currentProcess = {
      appPath: skillerAppPath,
      logPath: launchLogPath,
      process: child,
      scope,
      startedAtIso,
      trpcBasePath: skillerTrpcBasePath,
      trpcPort
    }
    child.once("exit", () => {
      if (currentProcess?.process.pid === child.pid) {
        currentProcess = null
      }
    })
    child.unref()
    return toLaunch(currentProcess, false, undefined)
  } finally {
    closeSync(logFd)
  }
}

const rememberSessionScope = (sessionId: string | undefined, scope: SkillerContainerScope | null): void => {
  if (sessionId !== undefined) {
    sessionScopes.set(sessionId, scope)
  }
}

export const openSkiller = (
  projectKey?: string,
  sessionId?: string
): Effect.Effect<
  SkillerLaunch,
  ApiConflictError | ApiInternalError | ApiNotFoundError | PlatformError,
  ListProjectsContext
> =>
  Effect.gen(function*(_) {
    const scope = yield* _(resolveRequestedSkillerScope(projectKey))
    rememberSessionScope(sessionId, scope)
    if (currentProcess !== null && isRunning(currentProcess.process)) {
      if (sameSkillerScope(currentProcess.scope, scope)) {
        yield* _(Effect.try({
          catch: (cause) => new ApiInternalError({
            message: "Failed to prepare selected container home for Skiller.",
            cause
          }),
          try: () => {
            prepareSkillerScopeHome(scope)
          }
        }))
        yield* _(waitForSkillerReady(currentProcess.trpcPort))
        yield* _(registerSkillerProject(currentProcess.trpcPort, scope))
        return toLaunch(currentProcess, true, sessionId)
      }
      stopSkillerProcess(currentProcess)
      currentProcess = null
    }
    const skillerDir = yield* _(resolveSkillerDir())
    const trpcPort = yield* _(Effect.tryPromise({
      catch: (cause) => new ApiInternalError({
        message: "Failed to reserve Skiller tRPC port.",
        cause
      }),
      try: () => findAvailablePort(skillerPreferredTrpcPort)
    }))
    const launch = yield* _(Effect.try({
      catch: (cause) => new ApiInternalError({
        message: "Failed to launch Skiller.",
        cause
      }),
      try: () => launchSkillerProcess(skillerDir, trpcPort, scope)
    }))
    yield* _(waitForSkillerReady(trpcPort))
    yield* _(registerSkillerProject(trpcPort, scope))
    return sessionId === undefined || currentProcess === null ? launch : toLaunch(currentProcess, false, sessionId)
  })

export const openSkillerForTerminalSession = (
  projectKey: string,
  sessionId: string
): Effect.Effect<
  SkillerLaunch,
  ApiConflictError | ApiInternalError | ApiNotFoundError | PlatformError,
  ListProjectsContext
> =>
  getProjectItemByKey(projectKey).pipe(
    Effect.flatMap((project) =>
      getProjectTerminalSession(project.projectDir, sessionId).pipe(
        Effect.as(projectKey)
      )
    ),
    Effect.flatMap((resolvedProjectKey) => openSkiller(resolvedProjectKey, sessionId))
  )

export const parseSkillerRoute = (pathname: string): SkillerRoute | null => {
  const normalized = pathname.startsWith("/api/") ? pathname.slice("/api".length) : pathname
  const sessionMatch = /^\/ssh\/session\/([^/]+)\/skiller(?:\/(app|trpc)(\/.*)?)?$/u.exec(normalized)
  if (sessionMatch !== null) {
    const sessionId = decodeURIComponent(sessionMatch[1] ?? "")
    const routeKind = sessionMatch[2] ?? ""
    const tail = sessionMatch[3] ?? ""
    if (routeKind === "app" || routeKind === "") {
      return { _tag: "App", relativePath: tail.length === 0 ? "/" : tail, sessionId }
    }
    if (routeKind === "trpc") {
      return { _tag: "Trpc", sessionId, upstreamPath: `/trpc${tail}` }
    }
  }
  if (normalized === "/skiller/app" || normalized === "/skiller/app/") {
    return { _tag: "App", relativePath: "/", sessionId: null }
  }
  if (normalized.startsWith("/skiller/app/")) {
    return { _tag: "App", relativePath: normalized.slice("/skiller/app".length), sessionId: null }
  }
  if (normalized === "/skiller/trpc" || normalized.startsWith("/skiller/trpc/")) {
    return { _tag: "Trpc", sessionId: null, upstreamPath: normalized.slice("/skiller".length) || "/trpc" }
  }
  return null
}

const contentTypeForPath = (path: string): string => {
  if (path.endsWith(".css")) {
    return "text/css; charset=utf-8"
  }
  if (path.endsWith(".js")) {
    return "application/javascript; charset=utf-8"
  }
  if (path.endsWith(".png")) {
    return "image/png"
  }
  if (path.endsWith(".svg")) {
    return "image/svg+xml"
  }
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8"
  }
  return "application/octet-stream"
}

const browserTrpcBaseBootstrap = [
  "<script>",
  "(() => {",
  "  const path = window.location.pathname;",
  "  const sessionMatch = /^(\\/api)?\\/ssh\\/session\\/([^/]+)\\/skiller\\/app(?:\\/|$)/.exec(path);",
  "  if (sessionMatch) {",
  "    const apiPrefix = sessionMatch[1] || '';",
  "    window.__SKILLER_TRPC_BASE_URL__ = `${window.location.origin}${apiPrefix}/ssh/session/${sessionMatch[2]}/skiller`;",
  "    return;",
  "  }",
  "  const apiPrefix = path.startsWith('/api/') ? '/api' : '';",
  "  window.__SKILLER_TRPC_BASE_URL__ = `${window.location.origin}${apiPrefix}/skiller`;",
  "})();",
  "</script>"
].join("")

const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c")

export const resolveSkillerBrowserScopeSelection = (
  route: Extract<SkillerRoute, { readonly _tag: "App" }>,
  currentScope: SkillerContainerScope | null,
  sessionScopeForId: (sessionId: string) => SkillerContainerScope | null | undefined
): SkillerBrowserScopeSelection | null => {
  if (route.sessionId === null) {
    return currentScope === null
      ? null
      : { scope: currentScope, sessionId: null }
  }
  const sessionScope = sessionScopeForId(route.sessionId)
  return sessionScope === undefined || sessionScope === null
    ? null
    : { scope: sessionScope, sessionId: route.sessionId }
}

const browserDockerGitScopeBootstrap = (
  route: Extract<SkillerRoute, { readonly _tag: "App" }>
): string => {
  const currentScope = currentProcess !== null && isRunning(currentProcess.process)
    ? currentProcess.scope
    : null
  const selection = resolveSkillerBrowserScopeSelection(
    route,
    currentScope,
    (sessionId) => sessionScopes.get(sessionId)
  )
  if (selection === null) {
    return ""
  }
  return [
    "<script>",
    `window.__DOCKER_GIT_SKILLER_SCOPE__=${scriptJson(skillerBrowserScopeForContainer(selection.scope, selection.sessionId))};`,
    "</script>"
  ].join("")
}

const injectBrowserBootstrap = (
  html: string,
  route: Extract<SkillerRoute, { readonly _tag: "App" }>
): string => {
  const bootstrap = `${browserTrpcBaseBootstrap}${browserDockerGitScopeBootstrap(route)}`
  return html.includes("<head>")
    ? html.replace("<head>", `<head>${bootstrap}`)
    : `${bootstrap}${html}`
}

const safeRendererPath = (skillerDir: string, relativePath: string): string => {
  const rendererDir = resolve(skillerDir, "out", "renderer")
  const rawRelativePath = relativePath === "/" ? "/index.html" : relativePath
  const decoded = decodeURIComponent(rawRelativePath)
  const target = resolve(rendererDir, `.${decoded}`)
  if (target !== rendererDir && !target.startsWith(`${rendererDir}/`)) {
    throw new Error("Skiller asset path escapes renderer directory.")
  }
  const stats = statSync(target)
  return stats.isDirectory() ? join(target, "index.html") : target
}

export const serveSkillerApp = (
  route: Extract<SkillerRoute, { readonly _tag: "App" }>
): Effect.Effect<HttpServerResponse.HttpServerResponse, ApiInternalError | ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const skillerDir = yield* _(resolveSkillerDir())
    const filePath = yield* _(Effect.try({
      catch: () => new ApiNotFoundError({
        message: "Skiller app asset was not found. Open Skiller once and wait for the build to finish."
      }),
      try: () => safeRendererPath(skillerDir, route.relativePath)
    }))
    const content = yield* _(Effect.try({
      catch: (cause) => new ApiInternalError({
        message: "Failed to read Skiller app asset.",
        cause
      }),
      try: () => readFileSync(filePath)
    }))
    if (filePath.endsWith(".html")) {
      return HttpServerResponse.text(injectBrowserBootstrap(content.toString("utf8"), route), {
        contentType: "text/html; charset=utf-8",
        headers: { "cache-control": "no-store" }
      })
    }
    return HttpServerResponse.uint8Array(new Uint8Array(content), {
      contentType: contentTypeForPath(filePath),
      headers: { "cache-control": "no-store" }
    })
  })

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
])

const copyRequestHeaders = (request: HttpServerRequest.HttpServerRequest): Headers => {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string" && !hopByHopHeaders.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }
  return headers
}

const copyResponseHeaders = (response: Response): Record<string, string> => {
  const headers: Record<string, string> = { "cache-control": "no-store" }
  response.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers[key] = value
    }
  })
  return headers
}

const verifySkillerRouteScope = (
  route: Extract<SkillerRoute, { readonly _tag: "Trpc" }>
): Effect.Effect<void, ApiConflictError> => {
  if (route.sessionId === null) {
    return Effect.void
  }
  const scope = sessionScopes.get(route.sessionId)
  if (scope === undefined) {
    return Effect.fail(new ApiConflictError({
      message: `Skiller session is not registered: ${route.sessionId}. Click the terminal Skiller button again.`
    }))
  }
  if (currentProcess === null || !sameSkillerScope(currentProcess.scope, scope)) {
    return Effect.fail(new ApiConflictError({
      message: `Skiller is not running for terminal session ${route.sessionId}. Click the terminal Skiller button again.`
    }))
  }
  return Effect.void
}

export const proxySkillerTrpc = (
  request: HttpServerRequest.HttpServerRequest,
  route: Extract<SkillerRoute, { readonly _tag: "Trpc" }>
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  ApiConflictError | ApiInternalError | HttpServerError.RequestError
> =>
  Effect.gen(function*(_) {
    if (currentProcess === null || !isRunning(currentProcess.process)) {
      return yield* _(Effect.fail(new ApiConflictError({
        message: "Skiller is not running. Click the Skiller button first."
      })))
    }
    yield* _(verifySkillerRouteScope(route))
    const parsed = new URL(request.url, "http://localhost")
    const upstreamUrl = new URL(
      `${route.upstreamPath}${parsed.search}`,
      `http://127.0.0.1:${currentProcess.trpcPort}`
    )
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : yield* _(request.arrayBuffer)
    const upstreamResponse = yield* _(Effect.tryPromise({
      catch: (cause) => new ApiInternalError({
        message: "Failed to proxy Skiller tRPC.",
        cause
      }),
      try: () => fetch(upstreamUrl, {
        ...(body === undefined ? {} : { body }),
        headers: copyRequestHeaders(request),
        method: request.method
      })
    }))
    const headers = copyResponseHeaders(upstreamResponse)
    if (request.method === "HEAD" || upstreamResponse.body === null) {
      return HttpServerResponse.empty({ headers, status: upstreamResponse.status })
    }
    return HttpServerResponse.stream(
      Stream.fromReadableStream(
        () => upstreamResponse.body as ReadableStream<Uint8Array>,
        (cause) => new ApiInternalError({ message: "Failed to read Skiller tRPC response.", cause })
      ),
      {
        headers,
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText
      }
    )
  })
