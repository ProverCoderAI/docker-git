import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"

import { ApiInternalError, ApiNotFoundError } from "../api/errors.js"

export type SkillerLaunch = {
  readonly alreadyRunning: boolean
  readonly logPath: string
  readonly pid: number | null
  readonly startedAtIso: string
}

type SkillerProcess = {
  readonly logPath: string
  readonly process: ChildProcess
  readonly startedAtIso: string
}

const submoduleRelativePath = join("third_party", "skiller-desktop-skills-manager")
const launchLogPath = join(homedir(), ".docker-git", "logs", "skiller.log")

let currentProcess: SkillerProcess | null = null

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

const launchScript = [
  "set -euo pipefail",
  "if [ ! -d node_modules ]; then bun install --frozen-lockfile; fi",
  "bun run build",
  "ln -sf index.mjs out/preload/index.js",
  "if [ -z \"${DISPLAY:-}\" ] && command -v xvfb-run >/dev/null 2>&1; then",
  "  exec xvfb-run -a ./node_modules/electron/dist/electron --no-sandbox out/main/index.js",
  "fi",
  "exec ./node_modules/electron/dist/electron --no-sandbox out/main/index.js"
].join("\n")

const launchSkillerProcess = (skillerDir: string): SkillerLaunch => {
  mkdirSync(dirname(launchLogPath), { recursive: true })
  const logFd = openSync(launchLogPath, "a")
  try {
    const child = spawn("bash", ["-lc", launchScript], {
      cwd: skillerDir,
      detached: true,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1"
      },
      stdio: ["ignore", logFd, logFd]
    })
    const startedAtIso = new Date().toISOString()
    currentProcess = { logPath: launchLogPath, process: child, startedAtIso }
    child.once("exit", () => {
      if (currentProcess?.process.pid === child.pid) {
        currentProcess = null
      }
    })
    child.unref()
    return {
      alreadyRunning: false,
      logPath: launchLogPath,
      pid: child.pid ?? null,
      startedAtIso
    }
  } finally {
    closeSync(logFd)
  }
}

export const openSkiller = (): Effect.Effect<SkillerLaunch, ApiInternalError | ApiNotFoundError> =>
  Effect.gen(function*(_) {
    if (currentProcess !== null && isRunning(currentProcess.process)) {
      return {
        alreadyRunning: true,
        logPath: currentProcess.logPath,
        pid: currentProcess.process.pid ?? null,
        startedAtIso: currentProcess.startedAtIso
      }
    }
    const skillerDir = yield* _(resolveSkillerDir())
    return yield* _(Effect.try({
      catch: (cause) => new ApiInternalError({
        message: "Failed to launch Skiller.",
        cause
      }),
      try: () => launchSkillerProcess(skillerDir)
    }))
  })
