import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

import { Duration, Effect } from "effect"

import type { PanelCloudflareTunnelSession, StartPanelCloudflareTunnelRequest } from "../api/contracts.js"
import { ApiBadRequestError, ApiInternalError } from "../api/errors.js"
import {
  parseTryCloudflareUrl,
  resolvePanelTunnelTargetUrl
} from "./panel-cloudflare-tunnel-core.js"
import { parseLinuxDefaultGatewayIp } from "./project-port-proxy-core.js"

type PanelCloudflareTunnelRecord = {
  readonly homeDir: string
  logLines: ReadonlyArray<string>
  process: ChildProcess | null
  session: PanelCloudflareTunnelSession
  stderrRemainder: string
  stopping: boolean
  stdoutRemainder: string
}

type PanelCloudflareTunnelError = ApiBadRequestError | ApiInternalError

const maxLogTailLines = 80
const startWaitAttempts = 60
const tunnelRecordLock = Effect.unsafeMakeSemaphore(1)
let currentRecord: PanelCloudflareTunnelRecord | null = null

const nowIso = (): string => new Date().toISOString()

const trimLogLines = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines.length <= maxLogTailLines ? lines : lines.slice(lines.length - maxLogTailLines)

const panelTunnelHomeDir = (id: string): string => join("/tmp", "docker-git-cloudflared", id)

const updateRecord = (
  record: PanelCloudflareTunnelRecord,
  patch: Partial<PanelCloudflareTunnelSession>
): PanelCloudflareTunnelSession => {
  record.session = {
    ...record.session,
    ...patch,
    logTail: record.logLines
  }
  if (currentRecord?.session.id === record.session.id) {
    currentRecord = record
  }
  return record.session
}

const appendLogLine = (
  record: PanelCloudflareTunnelRecord,
  line: string
): void => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return
  }

  record.logLines = trimLogLines([...record.logLines, trimmed])
  const publicUrl = parseTryCloudflareUrl(trimmed)
  updateRecord(
    record,
    publicUrl === null
      ? {}
      : {
        error: null,
        publicUrl,
        status: "running"
      }
  )
}

const flushRemainder = (
  record: PanelCloudflareTunnelRecord,
  stream: "stderr" | "stdout"
): void => {
  const remainder = stream === "stdout" ? record.stdoutRemainder : record.stderrRemainder
  if (remainder.length === 0) {
    return
  }
  appendLogLine(record, remainder)
  if (stream === "stdout") {
    record.stdoutRemainder = ""
  } else {
    record.stderrRemainder = ""
  }
}

const consumeChunk = (
  record: PanelCloudflareTunnelRecord,
  stream: "stderr" | "stdout",
  chunk: Buffer
): void => {
  const incoming = chunk.toString("utf8").replaceAll("\r", "\n")
  const withRemainder = (stream === "stdout" ? record.stdoutRemainder : record.stderrRemainder) + incoming
  const lines = withRemainder.split("\n")
  const tail = lines.pop() ?? ""
  for (const line of lines) {
    appendLogLine(record, line)
  }
  if (stream === "stdout") {
    record.stdoutRemainder = tail
  } else {
    record.stderrRemainder = tail
  }
}

const processEnv = (
  homeDir: string
): Readonly<Record<string, string | undefined>> => ({
  PATH: process.env["PATH"],
  SSL_CERT_DIR: process.env["SSL_CERT_DIR"],
  SSL_CERT_FILE: process.env["SSL_CERT_FILE"],
  HOME: homeDir,
  NO_COLOR: "1"
})

const readDefaultGatewayIp = (): Effect.Effect<string | null> =>
  Effect.try({
    try: () => parseLinuxDefaultGatewayIp(readFileSync("/proc/net/route", "utf8")),
    catch: () => null
  }).pipe(Effect.catchAll((fallback) => Effect.succeed(fallback)))

const defaultPanelTunnelLocalhostHost = (): Effect.Effect<string> => {
  const configured = process.env["DOCKER_GIT_PANEL_TUNNEL_LOCALHOST_HOST"]?.trim()
  if (configured !== undefined && configured.length > 0) {
    return Effect.succeed(configured)
  }
  return existsSync("/.dockerenv")
    ? readDefaultGatewayIp().pipe(Effect.map((gatewayIp) => gatewayIp ?? "172.17.0.1"))
    : Effect.succeed("127.0.0.1")
}

const createStartingRecord = (
  panelUrl: string
): PanelCloudflareTunnelRecord => {
  const id = randomUUID()
  const startedAt = nowIso()
  const homeDir = panelTunnelHomeDir(id)
  return {
    homeDir,
    logLines: [],
    process: null,
    session: {
      error: null,
      id,
      logTail: [],
      panelUrl,
      publicUrl: null,
      startedAt,
      status: "starting",
      stoppedAt: null
    },
    stderrRemainder: "",
    stopping: false,
    stdoutRemainder: ""
  }
}

const removeTunnelHomeBestEffort = (record: PanelCloudflareTunnelRecord): void => {
  try {
    rmSync(record.homeDir, { force: true, recursive: true })
  } catch {
    // best effort cleanup
  }
}

const discardUnstartedRecord = (record: PanelCloudflareTunnelRecord): Effect.Effect<void> =>
  Effect.sync(() => {
    if (currentRecord === record) {
      currentRecord = null
    }
    removeTunnelHomeBestEffort(record)
  })

const finishStoppedRecord = (
  record: PanelCloudflareTunnelRecord,
  error: string | null = null
): PanelCloudflareTunnelSession => {
  record.process = null
  record.stopping = false
  const session = updateRecord(record, {
    error,
    status: error === null ? "stopped" : "failed",
    stoppedAt: nowIso()
  })
  removeTunnelHomeBestEffort(record)
  return session
}

const waitForChildClose = (child: ChildProcess): Effect.Effect<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Effect.void
  }

  return Effect.async((resume) => {
    let completed = false
    let killTimer: ReturnType<typeof setTimeout> | null = null
    const complete = (): void => {
      if (completed) {
        return
      }
      completed = true
      child.off("close", complete)
      child.off("error", complete)
      child.off("exit", complete)
      if (killTimer !== null) {
        clearTimeout(killTimer)
      }
      resume(Effect.void)
    }

    child.once("close", complete)
    child.once("error", complete)
    child.once("exit", complete)
    if (!child.killed) {
      try {
        child.kill("SIGTERM")
      } catch {
        complete()
        return
      }
    }
    killTimer = setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL")
        }
      } catch {
        complete()
      }
    }, 2_000)
    killTimer.unref()
  })
}

const stopRecord = (
  record: PanelCloudflareTunnelRecord,
  error: string | null = null
): Effect.Effect<PanelCloudflareTunnelSession> => {
  const child = record.process
  record.process = null
  record.stopping = true
  return (child === null ? Effect.void : waitForChildClose(child)).pipe(
    Effect.map(() => finishStoppedRecord(record, error))
  )
}

const runStopRecord = (
  record: PanelCloudflareTunnelRecord,
  error: string
): void => {
  if (record.stopping || record.session.status === "stopped" || record.session.status === "failed") {
    return
  }
  Effect.runFork(stopRecord(record, error))
}

const attachProcessHandlers = (
  record: PanelCloudflareTunnelRecord,
  child: ChildProcess
): void => {
  record.process = child
  child.stdout?.on("data", (chunk: Buffer) => {
    consumeChunk(record, "stdout", chunk)
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    consumeChunk(record, "stderr", chunk)
  })
  child.on("error", (error) => {
    runStopRecord(record, `cloudflared failed to start: ${error.message}`)
  })
  child.on("close", (exitCode, signal) => {
    flushRemainder(record, "stdout")
    flushRemainder(record, "stderr")
    if (record.stopping || record.session.status === "stopped" || record.session.status === "failed") {
      return
    }
    const details = exitCode === null ? `signal ${signal ?? "unknown"}` : `exit code ${exitCode}`
    runStopRecord(record, `cloudflared exited before the tunnel was stopped (${details}).`)
  })
}

const startCloudflaredProcess = (
  record: PanelCloudflareTunnelRecord,
  targetUrl: string
): Effect.Effect<void, ApiInternalError> =>
  Effect.try({
    try: () => {
      mkdirSync(record.homeDir, { recursive: true })
      const child = spawn(
        "cloudflared",
        ["tunnel", "--no-autoupdate", "--url", targetUrl],
        {
          cwd: process.cwd(),
          env: processEnv(record.homeDir),
          stdio: ["ignore", "pipe", "pipe"]
        }
      )
      attachProcessHandlers(record, child)
    },
    catch: (cause) =>
      new ApiInternalError({
        message: "Failed to start cloudflared.",
        cause
      })
  })

const preflightPanelTarget = (
  targetUrl: string
): Effect.Effect<void, ApiBadRequestError> =>
  Effect.tryPromise({
    try: () =>
      fetch(targetUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000)
      }),
    catch: (cause) =>
      new ApiBadRequestError({
        message: `Panel URL is not reachable from the API controller: ${targetUrl}`,
        details: cause
      })
  }).pipe(Effect.asVoid)

const waitForTunnelUrl = (
  record: PanelCloudflareTunnelRecord,
  remainingAttempts: number
): Effect.Effect<PanelCloudflareTunnelSession, never> =>
  Effect.gen(function*(_) {
    const session = record.session
    if (
      session.publicUrl !== null ||
      isTerminalTunnelSession(session) ||
      remainingAttempts <= 0
    ) {
      return session
    }
    yield* _(Effect.sleep(Duration.millis(250)))
    return yield* _(waitForTunnelUrl(record, remainingAttempts - 1))
  })

const isReusableRecord = (
  record: PanelCloudflareTunnelRecord,
  panelUrl: string
): boolean =>
  record.session.panelUrl === panelUrl &&
  (record.session.status === "starting" || record.session.status === "running")

const isTerminalTunnelSession = (
  session: PanelCloudflareTunnelSession
): boolean => session.status === "failed" || session.status === "stopped"

const waitForRecord = (
  request: StartPanelCloudflareTunnelRequest
): Effect.Effect<PanelCloudflareTunnelRecord, PanelCloudflareTunnelError> =>
  Effect.gen(function*(_) {
    const localhostHost = yield* _(defaultPanelTunnelLocalhostHost())
    const resolved = resolvePanelTunnelTargetUrl(request.panelUrl, localhostHost)
    if (!resolved.ok) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: resolved.message })))
    }

    if (currentRecord !== null && isReusableRecord(currentRecord, resolved.panelUrl)) {
      return currentRecord
    }

    yield* _(preflightPanelTarget(resolved.targetUrl))
    if (currentRecord !== null) {
      yield* _(stopRecord(currentRecord))
    }

    const record = createStartingRecord(resolved.panelUrl)
    currentRecord = record
    yield* _(
      startCloudflaredProcess(record, resolved.targetUrl).pipe(
        Effect.tapError(() => discardUnstartedRecord(record))
      )
    )
    return record
  }).pipe(tunnelRecordLock.withPermits(1))

/**
 * Reads the currently tracked panel Cloudflare tunnel session.
 *
 * @returns The active session snapshot, or null when no tunnel record exists.
 * @pure false
 * @effect Reads shell-owned in-memory tunnel state under tunnelRecordLock.
 * @invariant Does not start, stop, or mutate the cloudflared process.
 * @precondition None.
 * @postcondition Returns null iff no current tunnel record is tracked.
 * @complexity O(1) time and O(1) space.
 * @throws Never - this effect has no typed failure channel.
 */
export const readPanelCloudflareTunnel = (): Effect.Effect<PanelCloudflareTunnelSession | null> =>
  Effect.sync(() => currentRecord?.session ?? null).pipe(tunnelRecordLock.withPermits(1))

/**
 * Starts or reuses a Cloudflare Quick Tunnel for the requested panel URL.
 *
 * @param request - Start request containing the local or private LAN panelUrl to expose.
 * @returns The reusable tunnel session, including publicUrl once cloudflared reports it.
 * @pure false
 * @effect Performs HTTP preflight, spawns cloudflared, reads env/filesystem state, and mutates tunnel state.
 * @invariant At most one current tunnel record is created or replaced under tunnelRecordLock.
 * @precondition request.panelUrl is a valid http(s) URL reachable from the API controller.
 * @postcondition On success, currentRecord tracks the starting or running tunnel for request.panelUrl.
 * @complexity O(startWaitAttempts + maxLogTailLines) time and O(maxLogTailLines) space.
 * @throws Never - failures are typed as PanelCloudflareTunnelError in the Effect error channel.
 */
export const startPanelCloudflareTunnel = (
  request: StartPanelCloudflareTunnelRequest
): Effect.Effect<PanelCloudflareTunnelSession, PanelCloudflareTunnelError> =>
  Effect.gen(function*(_) {
    const record = yield* _(waitForRecord(request))
    return yield* _(waitForTunnelUrl(record, startWaitAttempts))
  })

/**
 * Stops the currently tracked panel Cloudflare tunnel if one exists.
 *
 * @returns The current terminal session snapshot, stopped session snapshot, or null when no tunnel record exists.
 * @pure false
 * @effect Sends SIGTERM/SIGKILL to cloudflared, waits for process close, and removes tunnel home state.
 * @invariant Does not create a new tunnel record and serializes state changes under tunnelRecordLock.
 * @precondition None.
 * @postcondition Returns null iff no record existed; terminal records are returned unchanged, otherwise status is "stopped".
 * @complexity O(1) space and O(t) time where t is bounded by the process close/SIGKILL timeout.
 * @throws Never - this effect has no typed failure channel.
 */
export const stopPanelCloudflareTunnel = (): Effect.Effect<PanelCloudflareTunnelSession | null> =>
  Effect.gen(function*(_) {
    if (currentRecord === null) {
      return null
    }
    if (isTerminalTunnelSession(currentRecord.session)) {
      return currentRecord.session
    }
    return yield* _(stopRecord(currentRecord))
  }).pipe(tunnelRecordLock.withPermits(1))
