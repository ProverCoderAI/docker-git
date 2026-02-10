import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer"
import { Effect } from "effect"

import { PortProbeError } from "./errors.js"

type ErrnoError = Error & { readonly code?: string }

const normalizeMessage = (error: Error): string => error.message

const isErrnoError = (error: Error): error is ErrnoError => "code" in error

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
  Effect.scoped(NodeSocketServer.make({ host, port })).pipe(
    Effect.as(true),
    Effect.catchTag("SocketServerError", (error) => {
      const { cause } = error
      if (error.reason === "Open" && cause instanceof Error && isErrnoError(cause) && cause.code === "EADDRINUSE") {
        return Effect.succeed(false)
      }
      return Effect.fail(new PortProbeError({ port, message: normalizeMessage(error) }))
    })
  )

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
