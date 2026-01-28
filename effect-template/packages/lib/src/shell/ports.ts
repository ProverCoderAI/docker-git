import { Effect } from "effect"
import * as net from "node:net"

import { PortProbeError } from "./errors.js"

const normalizeMessage = (error: Error): string => error.message

const closeQuietly = (server: net.Server) => {
  if (server.listening) {
    server.close()
  }
}

// CHANGE: probe TCP port availability on localhost
// WHY: avoid docker compose failures due to port collisions
// QUOTE(ТЗ): "Bind for 127.0.0.1:2222 failed: port is already allocated"
// REF: user-request-2026-01-28-port
// SOURCE: n/a
// FORMAT THEOREM: forall p: available(p) -> can_bind(p)
// PURITY: SHELL
// EFFECT: Effect<boolean, PortProbeError, never>
// INVARIANT: returns false when the port is already in use
// COMPLEXITY: O(1)
export const isPortAvailable = (
  port: number,
  host: string = "127.0.0.1"
): Effect.Effect<boolean, PortProbeError> =>
  Effect.async<boolean, PortProbeError>((resume) => {
    const server = net.createServer()
    let done = false

    const finish = (effect: Effect.Effect<boolean, PortProbeError>) => {
      if (done) {
        return
      }
      done = true
      resume(effect)
    }

    server.unref()
    server.once("error", (error) => {
      const err = error as NodeJS.ErrnoException
      if (err.code === "EADDRINUSE") {
        closeQuietly(server)
        finish(Effect.succeed(false))
        return
      }
      closeQuietly(server)
      finish(Effect.fail(new PortProbeError({ port, message: normalizeMessage(error) })))
    })
    server.once("listening", () => {
      server.close(() => {
        finish(Effect.succeed(true))
      })
    })
    server.listen(port, host)

    return Effect.sync(() => {
      closeQuietly(server)
    })
  })

// CHANGE: select the first available port in a range
// WHY: auto-recover from occupied SSH ports
// QUOTE(ТЗ): "Bind for 127.0.0.1:2222 failed: port is already allocated"
// REF: user-request-2026-01-28-port
// SOURCE: n/a
// FORMAT THEOREM: forall p: find(p) -> available(find(p))
// PURITY: SHELL
// EFFECT: Effect<number, PortProbeError, never>
// INVARIANT: result is >= preferred when found
// COMPLEXITY: O(n) where n = |attempts|
export const findAvailablePort = (
  preferred: number,
  attempts: number,
  host: string = "127.0.0.1"
): Effect.Effect<number, PortProbeError> =>
  Effect.gen(function*(_) {
    const max = Math.max(1, attempts)
    for (let offset = 0; offset < max; offset += 1) {
      const candidate = preferred + offset
      const available = yield* _(isPortAvailable(candidate, host))
      if (available) {
        return candidate
      }
    }

    return yield* _(
      Effect.fail(
        new PortProbeError({
          port: preferred,
          message: `no available port in range ${preferred}-${preferred + max - 1}`
        })
      )
    )
  })
