import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Option } from "effect"

import { PortProbeError } from "../shell/errors.js"
import { isPortAvailable } from "../shell/ports.js"
import { listProjectItems } from "./projects-list.js"

export type ReservedPort = {
  readonly port: number
  readonly projectDir: string
}

const resolveExclude = (
  path: Path.Path,
  excludeDir: string | null
): string | null => (excludeDir === null ? null : path.resolve(excludeDir))

const filterReserved = (
  path: Path.Path,
  excludeDir: string | null
) =>
(item: { readonly projectDir: string }): boolean => {
  const resolvedExclude = resolveExclude(path, excludeDir)
  if (resolvedExclude === null) {
    return true
  }
  return path.resolve(item.projectDir) !== resolvedExclude
}

// CHANGE: collect SSH ports currently occupied by existing docker-git projects
// WHY: avoid port collisions while allowing reuse of ports from stopped projects
// QUOTE(ТЗ): "для каждого докера брать должен свой порт"
// REF: user-request-2026-02-05-port-reserve
// SOURCE: n/a
// FORMAT THEOREM: ∀p∈Projects: reserved(port(p))
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<ReservedPort>, PlatformError | PortProbeError, FileSystem | Path.Path>
// INVARIANT: excludes the current project dir when provided
// COMPLEXITY: O(n) where n = number of projects
export const loadReservedPorts = (
  excludeDir: string | null
): Effect.Effect<
  ReadonlyArray<ReservedPort>,
  PlatformError | PortProbeError,
  FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const items = yield* _(listProjectItems)
    const reserved: Array<ReservedPort> = []
    const filter = filterReserved(path, excludeDir)

    for (const item of items) {
      if (!filter(item)) {
        continue
      }
      if (!(yield* _(isPortAvailable(item.sshPort)))) {
        reserved.push({ port: item.sshPort, projectDir: item.projectDir })
      }
    }

    return reserved
  })

const isReserved = (reserved: ReadonlySet<number>, port: number): boolean => reserved.has(port)

const buildCandidates = (
  preferred: number,
  attempts: number,
  reserved: ReadonlySet<number>
): ReadonlyArray<number> => {
  const max = Math.max(1, attempts)
  return Array.from({ length: max }, (_, index) => preferred + index)
    .filter((candidate) => !isReserved(reserved, candidate))
}

// CHANGE: find the first non-reserved, available port from a preferred range
// WHY: avoid taking another project's assigned port
// QUOTE(ТЗ): "А не бороться за чужой порт"
// REF: user-request-2026-02-05-port-reserve
// SOURCE: n/a
// FORMAT THEOREM: ∀p: selected(p) → available(p) ∧ not_reserved(p)
// PURITY: SHELL
// EFFECT: Effect<number, PortProbeError, never>
// INVARIANT: result is >= preferred when found
// COMPLEXITY: O(n) where n = attempts
export const selectAvailablePort = (
  preferred: number,
  attempts: number,
  reserved: ReadonlySet<number>
): Effect.Effect<number, PortProbeError> =>
  Effect.gen(function*(_) {
    const candidates = buildCandidates(preferred, attempts, reserved)
    const selected = yield* _(
      Effect.reduce(candidates, Option.none<number>(), (current, candidate) =>
        Option.isSome(current)
          ? Effect.succeed(current)
          : isPortAvailable(candidate).pipe(
            Effect.map((available) => Option.fromNullable(available ? candidate : null))
          ))
    )
    if (Option.isSome(selected)) {
      return selected.value
    }
    return yield* _(
      Effect.fail(
        new PortProbeError({
          port: preferred,
          message: `no available port in range ${preferred}-${preferred + Math.max(1, attempts) - 1}`
        })
      )
    )
  })
