import type { PlatformError } from "@effect/platform/Error"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { runCommandCapture, runCommandWithExitCodes } from "@effect-template/lib/shell/command-runner"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { Effect } from "effect"

import type { ContainerTaskSnapshot, ProjectDetails } from "../api/contracts.js"
import { ApiInternalError, ApiNotFoundError } from "../api/errors.js"
import { listAgents } from "./agents.js"
import { activeAgents, buildContainerTasks, type ManagedAgentPid, type RawContainerProcess } from "./container-tasks-core.js"
import { getProject } from "./projects.js"
import { listProjectTerminalSessions } from "./terminal-sessions.js"

type JsonRecord = Readonly<Record<string, unknown>>

type ContainerTaskError = ApiInternalError | ApiNotFoundError | CommandFailedError | PlatformError
type ContainerTaskRequirements = CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path

const dockerOk = [0]
const maxLogLines = 2_000

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readNumber = (object: JsonRecord, key: string): number | null => {
  const value = object[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const readBoolean = (object: JsonRecord, key: string): boolean | null => {
  const value = object[key]
  return typeof value === "boolean" ? value : null
}

const readString = (object: JsonRecord, key: string): string | null => {
  const value = object[key]
  return typeof value === "string" ? value : null
}

const decodeRawProcess = (value: unknown): RawContainerProcess | null => {
  if (!isRecord(value)) {
    return null
  }

  const pid = readNumber(value, "pid")
  const ppid = readNumber(value, "ppid")
  const user = readString(value, "user")
  const tty = readString(value, "tty")
  const etime = readString(value, "etime")
  const etimes = readNumber(value, "etimes")
  const command = readString(value, "command")
  const baseline = readBoolean(value, "baseline")
  const logAvailable = readBoolean(value, "logAvailable")
  if (
    pid === null ||
    ppid === null ||
    user === null ||
    tty === null ||
    etime === null ||
    etimes === null ||
    command === null ||
    baseline === null ||
    logAvailable === null
  ) {
    return null
  }

  return {
    pid,
    ppid,
    user,
    tty,
    etime,
    etimes,
    command,
    baseline,
    logAvailable
  }
}

const decodeRawProcesses = (output: string): Effect.Effect<ReadonlyArray<RawContainerProcess>, ApiInternalError> =>
  Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(output)
      return Array.isArray(parsed)
        ? parsed
          .map((item) => decodeRawProcess(item))
          .filter((item): item is RawContainerProcess => item !== null)
        : []
    },
    catch: (error) =>
      new ApiInternalError({
        message: "Failed to decode container task snapshot.",
        cause: error
      })
  })

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const makeDockerExecSpec = (project: ProjectDetails, args: ReadonlyArray<string>) => ({
  cwd: project.projectDir,
  command: "docker",
  args: ["exec", project.containerName, ...args]
})

const runProjectContainerCapture = (
  project: ProjectDetails,
  args: ReadonlyArray<string>
): Effect.Effect<string, ContainerTaskError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    makeDockerExecSpec(project, args),
    dockerOk,
    (exitCode) => new CommandFailedError({ command: "docker exec", exitCode })
  )

const runProjectContainer = (
  project: ProjectDetails,
  args: ReadonlyArray<string>
): Effect.Effect<void, ContainerTaskError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    makeDockerExecSpec(project, args),
    dockerOk,
    (exitCode) => new CommandFailedError({ command: "docker exec", exitCode })
  )

const inspectProcessesScript = String.raw`
const fs = require('node:fs')
const cp = require('node:child_process')

const baselinePath = '/run/docker-git/terminal-baseline.pids'
const logRoot = '/run/docker-git/ssh-sessions'
const selfPid = process.pid

const readText = (path) => {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const readLink = (path) => {
  try {
    return fs.readlinkSync(path)
  } catch {
    return ''
  }
}

const readPasswd = () => {
  const map = new Map()
  for (const line of readText('/etc/passwd').split('\n')) {
    const parts = line.split(':')
    const user = parts[0]
    const uid = parts[2]
    if (user && uid) {
      map.set(uid, user)
    }
  }
  return map
}

const readBaseline = () =>
  new Set(
    readText(baselinePath)
      .split(/\s+/u)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value))
  )

const parseStatus = (pid) => {
  const status = readText('/proc/' + pid + '/status')
  const result = { ppid: 0, uid: '0' }
  for (const line of status.split('\n')) {
    if (line.startsWith('PPid:')) {
      result.ppid = Number.parseInt(line.slice(5).trim(), 10) || 0
    }
    if (line.startsWith('Uid:')) {
      result.uid = line.slice(4).trim().split(/\s+/u)[0] || '0'
    }
  }
  return result
}

const psField = (pid, field, fallback) => {
  try {
    const output = cp.execFileSync('ps', ['-p', String(pid), '-o', field + '='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return output.length === 0 ? fallback : output
  } catch {
    return fallback
  }
}

const commandForPid = (pid) => {
  const raw = readText('/proc/' + pid + '/cmdline')
  const command = raw.split('\u0000').filter(Boolean).join(' ').trim()
  if (command.length > 0) {
    return command
  }
  const comm = readText('/proc/' + pid + '/comm').trim()
  return comm.length === 0 ? '[' + pid + ']' : '[' + comm + ']'
}

const ttyForPid = (pid) => {
  const fdRoot = '/proc/' + pid + '/fd'
  let entries = []
  try {
    entries = fs.readdirSync(fdRoot)
  } catch {
    return '?'
  }
  for (const fd of entries) {
    const target = readLink(fdRoot + '/' + fd)
    if (target.startsWith('/dev/pts/') || target.startsWith('/dev/tty')) {
      return target.replace('/dev/', '')
    }
  }
  return psField(pid, 'tty', '?')
}

const readRecordedLogs = () => {
  const result = new Map()
  let entries = []
  try {
    entries = fs.readdirSync(logRoot)
  } catch {
    return result
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    try {
      const meta = JSON.parse(fs.readFileSync(logRoot + '/' + entry, 'utf8'))
      const pid = Number(meta.pid)
      const logPath = String(meta.logPath || '')
      if (Number.isFinite(pid) && logPath.length > 0 && fs.existsSync(logPath)) {
        result.set(pid, logPath)
      }
    } catch {
      continue
    }
  }
  return result
}

const fileBackedFdLog = (pid) => {
  for (const fd of ['1', '2']) {
    const target = readLink('/proc/' + pid + '/fd/' + fd)
    if (!target.startsWith('/') || target.startsWith('/dev/')) {
      continue
    }
    try {
      if (fs.statSync(target).isFile()) {
        return target
      }
    } catch {
      continue
    }
  }
  return null
}

const users = readPasswd()
const baseline = readBaseline()
const recordedLogs = readRecordedLogs()
const processes = []

for (const entry of fs.readdirSync('/proc')) {
  if (!/^\d+$/u.test(entry)) {
    continue
  }
  const pid = Number.parseInt(entry, 10)
  if (pid === selfPid) {
    continue
  }
  const status = parseStatus(pid)
  const command = commandForPid(pid)
  const logPath = recordedLogs.get(pid) || fileBackedFdLog(pid)
  processes.push({
    pid,
    ppid: status.ppid,
    user: users.get(status.uid) || status.uid,
    tty: ttyForPid(pid),
    etime: psField(pid, 'etime', ''),
    etimes: Number.parseInt(psField(pid, 'etimes', '0'), 10) || 0,
    command,
    baseline: baseline.has(pid),
    logAvailable: logPath !== null
  })
}

process.stdout.write(JSON.stringify(processes))
`

const readPidFile = (
  project: ProjectDetails,
  path: string
): Effect.Effect<number | null, ContainerTaskError, CommandExecutor.CommandExecutor> =>
  runProjectContainerCapture(
    project,
    ["bash", "-lc", `cat ${shellQuote(path)} 2>/dev/null || true`]
  ).pipe(
    Effect.map((output) => {
      const parsed = Number.parseInt(output.trim(), 10)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    })
  )

const readManagedAgentPids = (
  project: ProjectDetails
): Effect.Effect<ReadonlyArray<ManagedAgentPid>, ContainerTaskError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const agents = activeAgents(listAgents(project.id))
    const entries = yield* _(
      Effect.forEach(
        agents,
        (agent) =>
          readPidFile(project, agent.pidFile).pipe(
            Effect.map((pid) => pid === null ? null : { agentId: agent.id, pid }),
            Effect.catchAll(() => Effect.succeed(null))
          ),
        { concurrency: 4 }
      )
    )
    return entries.filter((entry): entry is ManagedAgentPid => entry !== null)
  })

const distinctSshConnections = (tasks: ContainerTaskSnapshot["tasks"]): number =>
  new Set(
    tasks
      .filter((task) => (task.kind === "ssh" || task.kind === "web-terminal") && task.tty !== "?")
      .map((task) => task.tty)
  ).size

// CHANGE: inspect only the explicitly selected project container for task-manager data.
// WHY: project inventory remains `.docker-git`-backed, while runtime process reads are an explicit action.
// QUOTE(ТЗ): "А должен ходить только в .docker-git папку ... .docker-git это наша база данных"
// REF: user-message-2026-04-22-container-task-manager
// SOURCE: n/a
// FORMAT THEOREM: forall snapshot: tasks(snapshot) subset processes(container(projectId))
// PURITY: SHELL
// EFFECT: Effect<ContainerTaskSnapshot, ContainerTaskError, CommandExecutor>
// INVARIANT: Docker is queried only for the selected projectId runtime snapshot
// COMPLEXITY: O(n + a) where n = process count and a = active agent count
export const readContainerTaskSnapshot = (
  projectId: string,
  includeDefault: boolean
): Effect.Effect<ContainerTaskSnapshot, ContainerTaskError, ContainerTaskRequirements> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProject(projectId))
    const { processes, managedAgentPids } = yield* _(
      Effect.all(
        {
          processes: runProjectContainerCapture(project, ["node", "-e", inspectProcessesScript]).pipe(
            Effect.flatMap(decodeRawProcesses)
          ),
          managedAgentPids: readManagedAgentPids(project)
        },
        { concurrency: "unbounded" }
      )
    )
    const tasks = buildContainerTasks(processes, managedAgentPids, includeDefault)
    return {
      projectId: project.id,
      containerName: project.containerName,
      generatedAt: new Date().toISOString(),
      sshConnections: distinctSshConnections(tasks),
      tasks,
      terminalSessions: listProjectTerminalSessions(project.id),
      agents: listAgents(project.id)
    }
  })

// CHANGE: stop a single process inside the selected project container.
// WHY: task-manager rows need a reversible control action without shelling into the project manually.
// QUOTE(ТЗ): "Можно ещё добавить диспетчер задач"
// REF: user-message-2026-04-22-container-task-manager
// SOURCE: n/a
// FORMAT THEOREM: forall pid > 0: stop(pid) sends exactly one TERM to pid
// PURITY: SHELL
// EFFECT: Effect<void, ContainerTaskError, CommandExecutor>
// INVARIANT: PID is passed as a positional kill operand, not interpolated into a shell command
// COMPLEXITY: O(1)
export const stopContainerTask = (
  projectId: string,
  pid: number
): Effect.Effect<void, ContainerTaskError, ContainerTaskRequirements> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProject(projectId))
    yield* _(runProjectContainer(project, ["kill", "-TERM", String(pid)]))
  })

const readLogsScript = String.raw`
const fs = require('node:fs')
const cp = require('node:child_process')

const pid = Number.parseInt(process.argv[1] || '', 10)
const lines = Math.max(1, Math.min(Number.parseInt(process.argv[2] || '200', 10) || 200, 2000))
const logRoot = '/run/docker-git/ssh-sessions'

const readLink = (path) => {
  try {
    return fs.readlinkSync(path)
  } catch {
    return ''
  }
}

const resolveRecordedLog = () => {
  let entries = []
  try {
    entries = fs.readdirSync(logRoot)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    try {
      const meta = JSON.parse(fs.readFileSync(logRoot + '/' + entry, 'utf8'))
      const metaPid = Number(meta.pid)
      const logPath = String(meta.logPath || '')
      if (metaPid === pid && logPath.length > 0 && fs.existsSync(logPath)) {
        return logPath
      }
    } catch {
      continue
    }
  }
  return null
}

const resolveFdLog = () => {
  if (!Number.isFinite(pid) || !fs.existsSync('/proc/' + pid)) {
    return null
  }
  for (const fd of ['1', '2']) {
    const target = readLink('/proc/' + pid + '/fd/' + fd)
    if (!target.startsWith('/') || target.startsWith('/dev/')) {
      continue
    }
    try {
      if (fs.statSync(target).isFile()) {
        return target
      }
    } catch {
      continue
    }
  }
  return null
}

const logPath = resolveRecordedLog() || resolveFdLog()
if (logPath === null) {
  process.stdout.write('No file-backed stdout/stderr or recorded SSH log for PID ' + pid + '\n')
} else {
  const output = cp.execFileSync('tail', ['-n', String(lines), logPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  process.stdout.write('Log file: ' + logPath + '\n' + output)
}
`

export const readContainerTaskLogs = (
  projectId: string,
  pid: number,
  lines: number
): Effect.Effect<string, ContainerTaskError, ContainerTaskRequirements> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProject(projectId))
    const safeLines = Number.isFinite(lines) && lines > 0 ? Math.min(Math.floor(lines), maxLogLines) : 200
    return yield* _(runProjectContainerCapture(project, ["node", "-e", readLogsScript, String(pid), String(safeLines)]))
  })
