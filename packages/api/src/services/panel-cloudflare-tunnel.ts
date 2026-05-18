import { spawn, type ChildProcess } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

import { Duration, Effect } from "effect"

import type { PanelCloudflareTunnelSession, StartPanelCloudflareTunnelRequest } from "../api/contracts.js"
import { ApiBadRequestError, ApiInternalError } from "../api/errors.js"
import {
  defaultPanelTunnelLocalhostHost,
  parseTryCloudflareUrl,
  resolvePanelTunnelTargetUrl
} from "./panel-cloudflare-tunnel-core.js"

type PanelCloudflareTunnelRecord = {
  readonly homeDir: string
  logLines: ReadonlyArray<string>
  process: ChildProcess | null
  session: PanelCloudflareTunnelSession
  stderrRemainder: string
  stdoutRemainder: string
}

type PanelCloudflareTunnelError = ApiBadRequestError | ApiInternalError

const maxLogTailLines = 80
const startWaitAttempts = 60
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
  ...process.env,
  HOME: homeDir,
  NO_COLOR: "1"
})

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

const stopRecord = (
  record: PanelCloudflareTunnelRecord,
  error: string | null = null
): PanelCloudflareTunnelSession => {
  const process = record.process
  record.process = null
  const session = updateRecord(record, {
    error,
    status: error === null ? "stopped" : "failed",
    stoppedAt: nowIso()
  })
  if (process !== null && !process.killed) {
    try {
      process.kill("SIGTERM")
    } catch {
      // process already exited
    }
    const killTimer = setTimeout(() => {
      try {
        if (process.exitCode === null && process.signalCode === null) {
          process.kill("SIGKILL")
        }
      } catch {
        // process already exited
      }
    }, 2_000)
    killTimer.unref()
  }
  removeTunnelHomeBestEffort(record)
  return session
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
    stopRecord(record, `cloudflared failed to start: ${error.message}`)
  })
  child.on("close", (exitCode, signal) => {
    flushRemainder(record, "stdout")
    flushRemainder(record, "stderr")
    if (record.session.status === "stopped" || record.session.status === "failed") {
      return
    }
    const details = exitCode === null ? `signal ${signal ?? "unknown"}` : `exit code ${exitCode}`
    stopRecord(record, `cloudflared exited before the tunnel was stopped (${details}).`)
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
  id: string,
  remainingAttempts: number
): Effect.Effect<PanelCloudflareTunnelSession, never> =>
  Effect.gen(function*(_) {
    const session = currentRecord?.session
    if (
      session === undefined ||
      session.id !== id ||
      session.publicUrl !== null ||
      session.status === "failed" ||
      session.status === "stopped" ||
      remainingAttempts <= 0
    ) {
      return session ?? {
        error: null,
        id,
        logTail: [],
        panelUrl: "",
        publicUrl: null,
        startedAt: nowIso(),
        status: "stopped",
        stoppedAt: nowIso()
      }
    }
    yield* _(Effect.sleep(Duration.millis(250)))
    return yield* _(waitForTunnelUrl(id, remainingAttempts - 1))
  })

const isReusableRecord = (
  record: PanelCloudflareTunnelRecord,
  panelUrl: string
): boolean =>
  record.session.panelUrl === panelUrl &&
  (record.session.status === "starting" || record.session.status === "running")

export const readPanelCloudflareTunnel = (): Effect.Effect<PanelCloudflareTunnelSession | null> =>
  Effect.sync(() => currentRecord?.session ?? null)

export const startPanelCloudflareTunnel = (
  request: StartPanelCloudflareTunnelRequest
): Effect.Effect<PanelCloudflareTunnelSession, PanelCloudflareTunnelError> =>
  Effect.gen(function*(_) {
    const resolved = resolvePanelTunnelTargetUrl(request.panelUrl, defaultPanelTunnelLocalhostHost())
    if (!resolved.ok) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: resolved.message })))
    }

    if (currentRecord !== null && isReusableRecord(currentRecord, resolved.panelUrl)) {
      return yield* _(waitForTunnelUrl(currentRecord.session.id, startWaitAttempts))
    }

    if (currentRecord !== null) {
      stopRecord(currentRecord)
    }

    yield* _(preflightPanelTarget(resolved.targetUrl))
    const record = createStartingRecord(resolved.panelUrl)
    currentRecord = record
    yield* _(startCloudflaredProcess(record, resolved.targetUrl))
    return yield* _(waitForTunnelUrl(record.session.id, startWaitAttempts))
  })

export const stopPanelCloudflareTunnel = (): Effect.Effect<PanelCloudflareTunnelSession | null> =>
  Effect.sync(() => currentRecord === null ? null : stopRecord(currentRecord))
