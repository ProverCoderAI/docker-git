import { Effect, pipe, Duration } from "effect"
import * as Stream from "effect/Stream"
import type { PlatformError } from "@effect/platform/Error"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"

import { DockerCommandError } from "../shell/errors.js"
import { appendDeploymentLog, setDeploymentStatus, type DeploymentPhase } from "./deployments.js"

const decoder = new TextDecoder("utf-8")

const decodeChunk = (chunk: Uint8Array): string => decoder.decode(chunk)

interface BuildStepInfo {
  readonly step: number
  readonly total: number
  readonly command: string
}

const heartbeatMs = 5000

const collectLines = (
  buffer: string,
  nextChunk: string
): { readonly lines: ReadonlyArray<string>; readonly rest: string } => {
  const combined = buffer + nextChunk
  const parts = combined.split(/\r\n|\n|\r/)
  if (parts.length === 0) {
    return { lines: [], rest: "" }
  }
  const rest = parts.pop() ?? ""
  return { lines: parts, rest }
}

// CHANGE: parse build step info from docker output
// WHY: surface deterministic stage metadata for long-running builds
// QUOTE(ТЗ): "не понимаю на каком этапе"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall line: parse(line) -> stepInfo | null
// PURITY: CORE
// EFFECT: Effect<BuildStepInfo | null, never, never>
// INVARIANT: returns null when no step is detected
// COMPLEXITY: O(1)
const parseBuildStep = (line: string): BuildStepInfo | null => {
  const stepMatch = line.match(/Step\s+(\d+)\/(\d+)\s*:\s*(.*)$/)
  if (stepMatch) {
    const step = Number(stepMatch[1])
    const total = Number(stepMatch[2])
    const command = stepMatch[3]?.trim() ?? ""
    if (Number.isFinite(step) && Number.isFinite(total)) {
      return { step, total, command }
    }
  }

  const buildkitMatch = line.match(/\[(\d+)\/(\d+)\]\s+RUN\s+(.*)$/)
  if (buildkitMatch) {
    const step = Number(buildkitMatch[1])
    const total = Number(buildkitMatch[2])
    const command = buildkitMatch[3]?.trim() ?? ""
    if (Number.isFinite(step) && Number.isFinite(total)) {
      return { step, total, command }
    }
  }

  return null
}

// CHANGE: format a step message for UI/heartbeat
// WHY: keep the current build step visible even with sparse logs
// QUOTE(ТЗ): "я не могу понять на каком этапе"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall s: format(s) -> string
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: message always includes step/total
// COMPLEXITY: O(1)
const formatStepMessage = (step: BuildStepInfo): string => {
  const command = step.command.length > 0 ? step.command : "running"
  return `Step ${step.step}/${step.total}: ${command}`
}

const makeComposeCommand = (cwd: string, args: ReadonlyArray<string>) =>
  pipe(
    Command.make("docker", "compose", ...args),
    Command.workingDirectory(cwd),
    Command.stdout("pipe"),
    Command.stderr("pipe")
  )

// CHANGE: run docker compose while streaming output into deployment status
// WHY: surface deploy progress, step metadata, and heartbeat during long builds
// QUOTE(ТЗ): "процесс деплоя отображать"
// REF: user-request-2026-01-13
// SOURCE: n/a
// FORMAT THEOREM: forall line: stream(line) -> status(line)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: status updated in order of output lines
// COMPLEXITY: O(n) where n = |output|
export const runComposeWithStatus = (
  cwd: string,
  args: ReadonlyArray<string>,
  okExitCodes: ReadonlyArray<number>,
  projectId: string,
  phase: DeploymentPhase
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function* (_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const process = yield* _(executor.start(makeComposeCommand(cwd, args)))
      const merged = Stream.merge(process.stdout, process.stderr)
      let buffer = ""
      let lastOutputAt = Date.now()
      let currentStep: BuildStepInfo | null = null

      if (phase === "build") {
        yield* _(
          Effect.forkScoped(
            Effect.gen(function* (_) {
              while (true) {
                yield* _(Effect.sleep(Duration.millis(heartbeatMs)))
                const now = Date.now()
                if (now - lastOutputAt >= heartbeatMs) {
                  const stepLabel = currentStep
                    ? formatStepMessage(currentStep)
                    : "build still running"
                  const heartbeatLine = `[heartbeat] ${stepLabel}`
                  lastOutputAt = now
                  yield* _(appendDeploymentLog(projectId, heartbeatLine))
                  yield* _(setDeploymentStatus(projectId, phase, heartbeatLine))
                }
              }
            })
          )
        )
      }

      yield* _(
        Stream.runForEach(merged, (chunk) =>
          Effect.gen(function* (_) {
            const text = decodeChunk(chunk)
            const output = collectLines(buffer, text)
            buffer = output.rest
            for (const line of output.lines) {
              const trimmed = line.trim()
              if (trimmed.length > 0) {
                const stepInfo = parseBuildStep(trimmed)
                if (stepInfo) {
                  currentStep = stepInfo
                }
                const message = stepInfo
                  ? formatStepMessage(stepInfo)
                  : currentStep
                    ? `${formatStepMessage(currentStep)} • ${trimmed}`
                    : trimmed
                lastOutputAt = Date.now()
                yield* _(appendDeploymentLog(projectId, trimmed))
                yield* _(setDeploymentStatus(projectId, phase, message))
              }
            }
          })
        )
      )

      if (buffer.trim().length > 0) {
        const trimmed = buffer.trim()
        const stepInfo = parseBuildStep(trimmed)
        if (stepInfo) {
          currentStep = stepInfo
        }
        const message = stepInfo
          ? formatStepMessage(stepInfo)
          : currentStep
            ? `${formatStepMessage(currentStep)} • ${trimmed}`
            : trimmed
        lastOutputAt = Date.now()
        yield* _(appendDeploymentLog(projectId, trimmed))
        yield* _(setDeploymentStatus(projectId, phase, message))
      }

      const exitCode = yield* _(process.exitCode)
      const numericExitCode = Number(exitCode)
      if (!okExitCodes.includes(numericExitCode)) {
        return yield* _(Effect.fail(new DockerCommandError({ exitCode: numericExitCode })))
      }
    })
  )
