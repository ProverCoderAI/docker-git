import { runCommandWithExitCodes } from "@effect-template/lib/shell/command-runner"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/path-helpers"
import { Effect } from "effect"
import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"

import type {
  AgentLogLine,
  AgentSession,
  CreateAgentRequest,
  ProjectDetails
} from "../api/contracts.js"
import { ApiBadRequestError, ApiConflictError, ApiNotFoundError } from "../api/errors.js"
import { emitProjectEvent } from "./events.js"

type AgentRecord = {
  session: AgentSession
  projectDir: string
  logs: Array<AgentLogLine>
  process: ChildProcess | null
  stdoutRemainder: string
  stderrRemainder: string
}

type SnapshotFile = {
  readonly sessions: ReadonlyArray<AgentSession>
}

const records: Map<string, AgentRecord> = new Map()
const projectIndex: Map<string, Set<string>> = new Map()
const maxLogLines = 5000
let initialized = false

const nowIso = (): string => new Date().toISOString()

const stateFilePath = (): string =>
  join(defaultProjectsRoot(process.cwd()), ".orch", "state", "api-agents.json")

const upsertProjectIndex = (projectId: string, agentId: string): void => {
  const current = projectIndex.get(projectId)
  if (current) {
    current.add(agentId)
    return
  }
  projectIndex.set(projectId, new Set([agentId]))
}

const shellEscape = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const sourceLabel = (request: CreateAgentRequest): string =>
  request.label?.trim().length ? request.label.trim() : request.provider

const pickDefaultCommand = (provider: CreateAgentRequest["provider"]): string => {
  if (provider === "codex") {
    return "codex"
  }
  if (provider === "opencode") {
    return "opencode"
  }
  if (provider === "claude") {
    return "claude"
  }
  return ""
}

const buildCommand = (request: CreateAgentRequest): string => {
  const direct = request.command?.trim() ?? ""
  if (direct.length > 0) {
    return direct
  }

  const base = pickDefaultCommand(request.provider)
  if (base.length === 0) {
    throw new ApiBadRequestError({ message: "Custom provider requires a non-empty 'command'." })
  }

  const args = (request.args ?? []).map((arg) => shellEscape(arg))
  return args.length === 0 ? base : `${base} ${args.join(" ")}`
}

const buildAgentScript = (
  sessionId: string,
  cwd: string,
  envEntries: ReadonlyArray<{ readonly key: string; readonly value: string }>,
  command: string
): string => {
  const pidFile = `/tmp/docker-git-agent-${sessionId}.pid`
  const exports = envEntries
    .map(({ key, value }) => `export ${key}=${shellEscape(value)}`)
    .join("\n")

  return [
    "set -euo pipefail",
    `PID_FILE=${shellEscape(pidFile)}`,
    "cleanup() { rm -f \"$PID_FILE\"; }",
    "trap cleanup EXIT",
    "echo $$ > \"$PID_FILE\"",
    `cd ${shellEscape(cwd)}`,
    exports,
    `exec ${command}`
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n")
}

const trimLogs = (logs: Array<AgentLogLine>): Array<AgentLogLine> =>
  logs.length <= maxLogLines ? logs : logs.slice(logs.length - maxLogLines)

const persistSnapshot = async (): Promise<void> => {
  const filePath = stateFilePath()
  await fs.mkdir(join(filePath, ".."), { recursive: true })
  const payload: SnapshotFile = {
    sessions: [...records.values()].map((record) => record.session)
  }
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8")
}

const persistSnapshotBestEffort = (): void => {
  void persistSnapshot().catch(() => {
    // best effort snapshot persistence
  })
}

const updateSession = (
  record: AgentRecord,
  patch: Partial<AgentSession>
): void => {
  record.session = {
    ...record.session,
    ...patch,
    updatedAt: nowIso()
  }
  records.set(record.session.id, record)
  persistSnapshotBestEffort()
}

const appendLog = (
  record: AgentRecord,
  stream: AgentLogLine["stream"],
  line: string
): void => {
  const entry: AgentLogLine = {
    at: nowIso(),
    stream,
    line
  }
  record.logs = trimLogs([...record.logs, entry])
  emitProjectEvent(record.session.projectId, "agent.output", {
    agentId: record.session.id,
    stream,
    line,
    at: entry.at
  })
}

const flushRemainder = (record: AgentRecord, stream: AgentLogLine["stream"]): void => {
  const remainder = stream === "stdout" ? record.stdoutRemainder : record.stderrRemainder
  if (remainder.length === 0) {
    return
  }
  appendLog(record, stream, remainder)
  if (stream === "stdout") {
    record.stdoutRemainder = ""
  } else {
    record.stderrRemainder = ""
  }
}

const consumeChunk = (
  record: AgentRecord,
  stream: AgentLogLine["stream"],
  chunk: Buffer
): void => {
  const incoming = chunk.toString("utf8")
  const withRemainder = (stream === "stdout" ? record.stdoutRemainder : record.stderrRemainder) + incoming
  const lines = withRemainder.split(/\r?\n/u)
  const tail = lines.pop() ?? ""

  for (const line of lines) {
    if (line.length > 0) {
      appendLog(record, stream, line)
    }
  }

  if (stream === "stdout") {
    record.stdoutRemainder = tail
  } else {
    record.stderrRemainder = tail
  }
}

const getProjectAgentIds = (projectId: string): ReadonlyArray<string> => {
  const ids = projectIndex.get(projectId)
  return ids ? [...ids] : []
}

const getRecordOrFail = (
  projectId: string,
  agentId: string
): Effect.Effect<AgentRecord, ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const record = records.get(agentId)
    if (!record || record.session.projectId !== projectId) {
      return yield* _(
        Effect.fail(
          new ApiNotFoundError({ message: `Agent not found: ${agentId} in project ${projectId}` })
        )
      )
    }
    return record
  })

const endedStatuses: ReadonlySet<AgentSession["status"]> = new Set(["stopped", "exited", "failed"])

const killAgentScript = (sessionId: string): string => {
  const pidFile = `/tmp/docker-git-agent-${sessionId}.pid`
  return [
    "set -eu",
    `PID_FILE=${shellEscape(pidFile)}`,
    "if [ -f \"$PID_FILE\" ]; then",
    "  PID=$(cat \"$PID_FILE\" 2>/dev/null || true)",
    "  if [ -n \"$PID\" ]; then",
    "    kill -TERM \"$PID\" 2>/dev/null || true",
    "    sleep 2",
    "    if kill -0 \"$PID\" 2>/dev/null; then kill -KILL \"$PID\" 2>/dev/null || true; fi",
    "  fi",
    "fi"
  ].join("\n")
}

const hydrateFromSnapshot = async (): Promise<void> => {
  const filePath = stateFilePath()
  const exists = await fs.stat(filePath).then(() => true).catch(() => false)
  if (!exists) {
    return
  }

  const raw = await fs.readFile(filePath, "utf8")
  const parsed = JSON.parse(raw) as SnapshotFile
  for (const session of parsed.sessions ?? []) {
    const restored: AgentSession = {
      ...session,
      status: endedStatuses.has(session.status) ? session.status : "exited",
      hostPid: null,
      stoppedAt: session.stoppedAt ?? nowIso(),
      updatedAt: nowIso()
    }

    const record: AgentRecord = {
      session: restored,
      projectDir: "",
      logs: [],
      process: null,
      stdoutRemainder: "",
      stderrRemainder: ""
    }

    records.set(restored.id, record)
    upsertProjectIndex(restored.projectId, restored.id)
  }
}

export const initializeAgentState = () =>
  Effect.tryPromise({
    try: async () => {
      if (initialized) {
        return
      }
      await hydrateFromSnapshot()
      initialized = true
    },
    catch: (error) => new Error(String(error))
  }).pipe(
    Effect.catchAll(() => Effect.void),
    Effect.asVoid
  )

// CHANGE: start an agent process inside a project container and register it for API control.
// WHY: issue #84 requires non-CLI lifecycle control for Codex/OpenCode/Claude runs.
// QUOTE(ТЗ): "Запускать агентов"
// REF: issue-84-agent-start
// SOURCE: n/a
// FORMAT THEOREM: forall req: valid(req) -> exists(session(req))
// PURITY: SHELL
// EFFECT: Effect<AgentSession, ApiBadRequestError | ApiConflictError>
// INVARIANT: agent ids are unique UUIDs and state snapshots are persisted best-effort
// COMPLEXITY: O(1)
export const startAgent = (
  project: ProjectDetails,
  request: CreateAgentRequest
)=>
  Effect.try({
    try: () => {
      const command = buildCommand(request)
      const sessionId = randomUUID()
      const pidFile = `/tmp/docker-git-agent-${sessionId}.pid`
      const label = sourceLabel(request)
      const startedAt = nowIso()
      const workingDir = request.cwd?.trim() || project.targetDir

      const session: AgentSession = {
        id: sessionId,
        projectId: project.id,
        provider: request.provider,
        label,
        command,
        containerName: project.containerName,
        status: "starting",
        source: `provider:${request.provider}`,
        pidFile,
        hostPid: null,
        startedAt,
        updatedAt: startedAt
      }

      const record: AgentRecord = {
        session,
        projectDir: project.projectDir,
        logs: [],
        process: null,
        stdoutRemainder: "",
        stderrRemainder: ""
      }

      records.set(sessionId, record)
      upsertProjectIndex(project.id, sessionId)

      const script = buildAgentScript(sessionId, workingDir, request.env ?? [], command)
      const child = spawn(
        "docker",
        ["exec", "-i", project.containerName, "bash", "-lc", script],
        {
          cwd: project.projectDir,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"]
        }
      )

      record.process = child
      updateSession(record, {
        status: "running",
        hostPid: child.pid ?? null
      })

      emitProjectEvent(project.id, "agent.started", {
        agentId: sessionId,
        provider: request.provider,
        label,
        command
      })

      child.stdout.on("data", (chunk: Buffer) => {
        consumeChunk(record, "stdout", chunk)
      })

      child.stderr.on("data", (chunk: Buffer) => {
        consumeChunk(record, "stderr", chunk)
      })

      child.on("error", (error) => {
        updateSession(record, {
          status: "failed",
          stoppedAt: nowIso()
        })
        emitProjectEvent(project.id, "agent.error", {
          agentId: sessionId,
          message: error.message
        })
      })

      child.on("close", (exitCode, signal) => {
        flushRemainder(record, "stdout")
        flushRemainder(record, "stderr")

        const expectedStop = record.session.status === "stopping" || record.session.status === "stopped"
        const nextStatus: AgentSession["status"] = expectedStop
          ? "stopped"
          : (exitCode === 0 ? "exited" : "failed")

        updateSession(record, {
          status: nextStatus,
          hostPid: null,
          stoppedAt: nowIso(),
          ...(exitCode === null ? {} : { exitCode }),
          ...(signal === null ? {} : { signal })
        })

        emitProjectEvent(project.id, expectedStop ? "agent.stopped" : "agent.exited", {
          agentId: sessionId,
          exitCode,
          signal,
          status: nextStatus
        })
      })

      persistSnapshotBestEffort()
      return record.session
    },
    catch: (error) => {
      if (error instanceof ApiBadRequestError) {
        return error
      }
      if (error instanceof ApiConflictError) {
        return error
      }
      return new ApiConflictError({ message: `Failed to start agent: ${String(error)}` })
    }
  })

export const listAgents = (projectId: string): ReadonlyArray<AgentSession> =>
  getProjectAgentIds(projectId)
    .map((id) => records.get(id))
    .filter((record): record is AgentRecord => Boolean(record))
    .map((record) => record.session)

export const getAgent = (
  projectId: string,
  agentId: string
) =>
  getRecordOrFail(projectId, agentId).pipe(Effect.map((record) => record.session))

export const stopAgent = (
  projectId: string,
  projectDir: string,
  containerName: string,
  agentId: string
)=>
  Effect.gen(function*(_) {
    const record = yield* _(getRecordOrFail(projectId, agentId))

    if (endedStatuses.has(record.session.status)) {
      return record.session
    }

    updateSession(record, { status: "stopping" })

    const command = killAgentScript(agentId)
    yield* _(
      runCommandWithExitCodes(
        {
          cwd: projectDir,
          command: "docker",
          args: ["exec", containerName, "bash", "-lc", command]
        },
        [0],
        (exitCode) => new CommandFailedError({ command: "docker exec kill-agent", exitCode })
      ).pipe(Effect.catchAll(() => Effect.void))
    )

    if (record.process && !record.process.killed) {
      record.process.kill("SIGTERM")
    }

    emitProjectEvent(projectId, "agent.stopped", { agentId, message: "Stop signal sent" })
    return record.session
  })

export const readAgentLogs = (
  projectId: string,
  agentId: string,
  lines: number
)=>
  getRecordOrFail(projectId, agentId).pipe(
    Effect.map((record) => {
      const safe = Number.isFinite(lines) && lines > 0 ? Math.min(Math.floor(lines), maxLogLines) : 200
      return record.logs.slice(record.logs.length - safe)
    })
  )

export const getAgentAttachInfo = (
  projectId: string,
  agentId: string
)=>
  getRecordOrFail(projectId, agentId).pipe(
    Effect.map((record) => ({
      projectId,
      agentId,
      containerName: record.session.containerName,
      pidFile: record.session.pidFile,
      inspectCommand: `docker exec ${record.session.containerName} bash -lc 'cat ${record.session.pidFile}'`,
      shellCommand: `docker exec -it ${record.session.containerName} bash`
    }))
  )
