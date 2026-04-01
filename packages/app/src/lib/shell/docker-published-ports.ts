import { ExitCode } from "@effect/platform/CommandExecutor"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

import { runCommandCapture } from "./command-runner.js"
import { CommandFailedError } from "./errors.js"

const publishedHostPortPattern = /:(\d+)->/g

const parsePublishedHostPortsFromLine = (line: string): ReadonlyArray<number> => {
  const parsed: Array<number> = []
  for (const match of line.matchAll(publishedHostPortPattern)) {
    const rawPort = match[1]
    if (rawPort === undefined) {
      continue
    }
    const value = Number.parseInt(rawPort, 10)
    if (Number.isInteger(value) && value > 0 && value <= 65_535) {
      parsed.push(value)
    }
  }
  return parsed
}

// CHANGE: decode published host ports from `docker ps --format "{{.Ports}}"` output
// WHY: Docker can reserve host ports via NAT even when no host TCP socket is visible
// QUOTE(ТЗ): "должен просто новый порт брать под себя"
// REF: user-request-2026-02-19-port-allocation
// SOURCE: n/a
// FORMAT THEOREM: forall p in parse(output): published_by_docker(p)
// PURITY: CORE
// EFFECT: Effect<ReadonlyArray<number>, never, never>
// INVARIANT: returns unique ports in encounter order
// COMPLEXITY: O(|output|)
export const parseDockerPublishedHostPorts = (output: string): ReadonlyArray<number> => {
  const unique = new Set<number>()
  const parsed: Array<number> = []

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    for (const port of parsePublishedHostPortsFromLine(trimmed)) {
      if (!unique.has(port)) {
        unique.add(port)
        parsed.push(port)
      }
    }
  }

  return parsed
}

// CHANGE: read currently published Docker host ports from running containers
// WHY: avoid false "free port" results when Docker reserves ports without userland proxy sockets
// QUOTE(ТЗ): "а не сражаться за старый"
// REF: user-request-2026-02-19-port-allocation
// SOURCE: n/a
// FORMAT THEOREM: forall p in result: published_by_running_container(p)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<number>, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: output ports are unique
// COMPLEXITY: O(command + |stdout|)
export const runDockerPsPublishedHostPorts = (
  cwd: string
): Effect.Effect<ReadonlyArray<number>, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runCommandCapture(
      {
        cwd,
        command: "docker",
        args: ["ps", "--format", "{{.Ports}}"]
      },
      [Number(ExitCode(0))],
      (exitCode) => new CommandFailedError({ command: "docker ps", exitCode })
    ),
    Effect.map((output) => parseDockerPublishedHostPorts(output))
  )
