// CHANGE: per-project SSH cloudflared tunnels for VS Code Remote SSH access
// WHY: share-link tunnels are tied to tokens and expire; containers need a
//      persistent tunnel that lives as long as the container is running
// QUOTE(ТЗ): "запускать cloudflare tunnel под каждый контейнер"
// REF: issue-428
// FORMAT THEOREM: ∀ projectKey: started(projectKey, port) → ∃ hostname: cfSsh(hostname, port)
// PURITY: SHELL
// EFFECT: Effect<string | null, ApiInternalError>
// INVARIANT: at most one tunnel record per projectKey is active at any time
// COMPLEXITY: O(1) lookup, O(startWaitAttempts * 250ms) start wait

import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

import { Duration, Effect, Fiber } from "effect"

import { ApiInternalError } from "../api/errors.js"
import { parseTryCloudflareUrl } from "./panel-cloudflare-tunnel-core.js"
import { parseLinuxDefaultGatewayIp } from "./project-port-proxy-core.js"
import { generateSshPassword, enableContainerPasswordAuth } from "./ssh-password-setup.js"

type SshTunnelRecord = {
  readonly homeDir: string
  process: ChildProcess | null
  processClosed: boolean
  hostname: string | null
  sshPassword: string
  stopping: boolean
  stopFiber: Fiber.RuntimeFiber<void> | null
  stdoutRemainder: string
  stderrRemainder: string
}

const projectTunnelMap = new Map<string, SshTunnelRecord>()
const projectTunnelLock = Effect.unsafeMakeSemaphore(1)
const startWaitAttempts = 60

const sshTunnelHomeDir = (id: string): string => join("/tmp", "docker-git-project-tunnels", id)

const processEnv = (homeDir: string): Readonly<Record<string, string | undefined>> => ({
  HOME: homeDir,
  NO_COLOR: "1",
  PATH: process.env["PATH"],
  SSL_CERT_DIR: process.env["SSL_CERT_DIR"],
  SSL_CERT_FILE: process.env["SSL_CERT_FILE"]
})

const readDefaultGatewayIp = (): Effect.Effect<string | null> =>
  Effect.try(() => parseLinuxDefaultGatewayIp(readFileSync("/proc/net/route", "utf8"))).pipe(
    Effect.orElse(() => Effect.succeed(null))
  )

const defaultLocalhostHost = (): Effect.Effect<string> => {
  const configured = process.env["DOCKER_GIT_PANEL_TUNNEL_LOCALHOST_HOST"]?.trim()
  if (configured !== undefined && configured.length > 0) {
    return Effect.succeed(configured)
  }
  return existsSync("/.dockerenv")
    ? readDefaultGatewayIp().pipe(Effect.map((ip) => ip ?? "172.17.0.1"))
    : Effect.succeed("127.0.0.1")
}

const appendLog = (record: SshTunnelRecord, text: string): void => {
  if (record.hostname !== null) return
  const url = parseTryCloudflareUrl(text)
  if (url === null) return
  try {
    record.hostname = new URL(url).hostname
  } catch {
    // ignore malformed URL
  }
}

const consumeChunk = (
  record: SshTunnelRecord,
  stream: "stderr" | "stdout",
  chunk: Buffer
): void => {
  const incoming = chunk.toString("utf8").replaceAll("\r", "\n")
  const withRemainder = (stream === "stdout" ? record.stdoutRemainder : record.stderrRemainder) + incoming
  const lines = withRemainder.split("\n")
  const tail = lines.pop() ?? ""
  for (const line of lines) {
    appendLog(record, line)
  }
  if (stream === "stdout") {
    record.stdoutRemainder = tail
  } else {
    record.stderrRemainder = tail
  }
}

const cleanupRecord = (record: SshTunnelRecord): void => {
  try {
    rmSync(record.homeDir, { force: true, recursive: true })
  } catch {
    // best effort
  }
}

const waitForChildClose = (
  record: SshTunnelRecord,
  child: ChildProcess
): Effect.Effect<void> => {
  if (record.processClosed) {
    return Effect.void
  }
  return Effect.async((resume) => {
    const alreadyExited = child.exitCode !== null || child.signalCode !== null
    let completed = false
    let killTimer: ReturnType<typeof setTimeout> | null = null
    const complete = (): void => {
      if (completed) return
      completed = true
      child.off("close", complete)
      child.off("error", complete)
      if (killTimer !== null) clearTimeout(killTimer)
      resume(Effect.void)
    }
    child.once("close", complete)
    child.once("error", complete)
    if (!alreadyExited && !child.killed) {
      try {
        child.kill("SIGTERM")
      } catch {
        complete()
        return
      }
    }
    if (!alreadyExited) {
      killTimer = setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
        } catch {
          complete()
        }
      }, 2_000)
      killTimer.unref()
    }
  })
}

const stopRecord = (record: SshTunnelRecord): Effect.Effect<void> => {
  if (record.stopFiber !== null) {
    return Fiber.join(record.stopFiber).pipe(Effect.asVoid)
  }
  const child = record.process
  record.stopping = true
  const fiber = Effect.runFork(
    (child === null ? Effect.void : waitForChildClose(record, child)).pipe(
      Effect.tap(() => Effect.sync(() => { cleanupRecord(record) }))
    )
  )
  record.stopFiber = fiber
  return Fiber.join(fiber).pipe(Effect.asVoid)
}

const attachHandlers = (record: SshTunnelRecord, child: ChildProcess): void => {
  record.process = child
  record.processClosed = false
  child.stdout?.on("data", (chunk: Buffer) => { consumeChunk(record, "stdout", chunk) })
  child.stderr?.on("data", (chunk: Buffer) => { consumeChunk(record, "stderr", chunk) })
  child.on("close", () => { record.processClosed = true })
  child.on("error", () => { record.processClosed = true })
}

const waitForHostname = (
  record: SshTunnelRecord,
  remainingAttempts: number
): Effect.Effect<string | null> =>
  Effect.gen(function*(_) {
    if (record.hostname !== null || record.stopping || remainingAttempts <= 0) {
      return record.hostname
    }
    yield* _(Effect.sleep(Duration.millis(250)))
    return yield* _(waitForHostname(record, remainingAttempts - 1))
  })

/**
 * Starts a dedicated SSH cloudflared quick tunnel for the given project.
 * Idempotent — returns existing hostname if a tunnel is already running.
 *
 * @param projectKey - Project key used as the map key (one tunnel per project).
 * @param sshPort - Host-mapped SSH port for the container.
 * @returns CF hostname (e.g. "abc.trycloudflare.com") or null if startup timed out.
 * @pure false
 * @effect Spawns cloudflared process, reads /proc/net/route, writes to /tmp.
 * @invariant Only one active record per projectKey — prior record is stopped before restart.
 * @precondition sshPort > 0
 * @postcondition On success, getSshProjectTunnelHostname(projectKey) returns the same hostname.
 * @complexity O(startWaitAttempts * 250ms) time for startup wait.
 * @throws Never - failures are typed as ApiInternalError in the Effect error channel.
 */
export const startSshProjectTunnel = (
  projectKey: string,
  sshPort: number,
  containerName: string
): Effect.Effect<{ hostname: string | null; sshPassword: string }, ApiInternalError> =>
  Effect.gen(function*(_) {
    const existing = projectTunnelMap.get(projectKey)
    if (existing !== undefined && !existing.stopping && !existing.processClosed && existing.hostname !== null) {
      return { hostname: existing.hostname, sshPassword: existing.sshPassword }
    }
    if (existing !== undefined) {
      yield* _(stopRecord(existing).pipe(Effect.orElse(() => Effect.void)))
      projectTunnelMap.delete(projectKey)
    }

    const sshPassword = generateSshPassword()
    yield* _(enableContainerPasswordAuth(containerName, sshPassword).pipe(Effect.orElse(() => Effect.void)))

    const localhostHost = yield* _(defaultLocalhostHost())
    const sshUrl = `ssh://${localhostHost}:${sshPort}`
    const homeDir = sshTunnelHomeDir(randomUUID())
    const record: SshTunnelRecord = {
      homeDir,
      hostname: null,
      process: null,
      processClosed: false,
      sshPassword,
      stderrRemainder: "",
      stdoutRemainder: "",
      stopFiber: null,
      stopping: false
    }
    projectTunnelMap.set(projectKey, record)

    yield* _(
      Effect.try({
        catch: (cause) => new ApiInternalError({ message: "Failed to start project SSH cloudflared tunnel.", cause }),
        try: () => {
          mkdirSync(record.homeDir, { recursive: true })
          const child = spawn(
            "cloudflared",
            ["tunnel", "--no-autoupdate", "--url", sshUrl],
            {
              cwd: process.cwd(),
              env: processEnv(record.homeDir),
              stdio: ["ignore", "pipe", "pipe"]
            }
          )
          attachHandlers(record, child)
        }
      })
    )

    const hostname = yield* _(waitForHostname(record, startWaitAttempts))
    return { hostname, sshPassword }
  }).pipe(projectTunnelLock.withPermits(1))

/**
 * Stops and removes the SSH cloudflared tunnel for the given project key.
 *
 * @param projectKey - Project key whose tunnel should be stopped.
 * @pure false
 * @effect Sends SIGTERM/SIGKILL to cloudflared, removes tunnel home directory.
 * @invariant No-op when no tunnel exists for the projectKey.
 * @complexity O(process close timeout) time.
 * @throws Never - this effect has no typed failure channel.
 */
export const stopSshProjectTunnel = (projectKey: string): Effect.Effect<void> =>
  Effect.gen(function*(_) {
    const record = projectTunnelMap.get(projectKey)
    if (record === undefined) return
    projectTunnelMap.delete(projectKey)
    yield* _(stopRecord(record).pipe(Effect.orElse(() => Effect.void)))
  }).pipe(projectTunnelLock.withPermits(1))

/**
 * Returns the current CF hostname for the SSH tunnel associated with the given project key.
 *
 * @param projectKey - Project key to look up.
 * @returns CF hostname string or null if tunnel not running / hostname not yet available.
 * @pure true (read-only snapshot)
 * @complexity O(1)
 */
export const getSshProjectTunnelHostname = (projectKey: string): string | null =>
  projectTunnelMap.get(projectKey)?.hostname ?? null
