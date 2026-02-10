import { Effect, pipe } from "effect"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import {
  runDockerComposeDown,
  runDockerComposePsFormatted,
  runDockerComposeUp,
  runDockerInspectContainerIp
} from "@effect-template/lib/shell/docker"
import { listProjectItems, type ProjectItem } from "@effect-template/lib/usecases/projects"

import type { JobInfo, PortInfo, ProjectDetails, ProjectStatus, ProjectSummary } from "../lib/api-types"
import { ensureProjectsRoot } from "./projects-root"
import { getRecreateStatus, markRecreateStatus } from "./recreate-state"

type ComposeRow = {
  readonly name: string
  readonly status: string
  readonly ports: string
  readonly image: string
}

const formatRepoRef = (repoRef: string): string => {
  const trimmed = repoRef.trim()
  const match = /^refs\/pull\/(\d+)\/head$/u.exec(trimmed)
  if (match && match[1]) {
    return `PR#${match[1]}`
  }
  return trimmed.length > 0 ? trimmed : "unknown"
}

const normalizeCell = (value: string | undefined): string => value?.trim() ?? "-"

const parseComposeRow = (line: string): ComposeRow => {
  const [name, status, ports, image] = line.split("\t")
  return {
    name: normalizeCell(name),
    status: normalizeCell(status),
    ports: normalizeCell(ports),
    image: normalizeCell(image)
  }
}

const parseComposeRows = (raw: string): ReadonlyArray<ComposeRow> =>
  raw
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => parseComposeRow(line))

const statusFromRows = (rows: ReadonlyArray<ComposeRow>): ProjectStatus => {
  if (rows.length === 0) {
    return "stopped"
  }
  const normalized = rows.map((row) => row.status.toLowerCase())
  if (normalized.some((value) => value.includes("up") || value.includes("running"))) {
    return "running"
  }
  if (normalized.some((value) => value.includes("exited") || value.includes("stopped"))) {
    return "stopped"
  }
  return "unknown"
}

const statusLabelFromRows = (rows: ReadonlyArray<ComposeRow>): string => {
  if (rows.length === 0) {
    return "stopped"
  }
  return rows.map((row) => row.status).join(", ")
}

const collectPorts = (rows: ReadonlyArray<ComposeRow>): ReadonlyArray<number> => {
  const ports: Array<number> = []
  const portRegex = /:(\d+)->/gu
  for (const row of rows) {
    if (row.ports === "-" || row.ports.length === 0) {
      continue
    }
    const matches = row.ports.matchAll(portRegex)
    for (const match of matches) {
      const value = Number(match[1])
      if (!Number.isNaN(value) && !ports.includes(value)) {
        ports.push(value)
      }
    }
  }
  return ports
}

const labelForPort = (port: number): string => {
  if (port === 22) {
    return "SSH"
  }
  if (port === 5173) {
    return "Vite"
  }
  if (port === 3000) {
    return "API"
  }
  return "tcp"
}

const buildPorts = (ports: ReadonlyArray<number>): ReadonlyArray<PortInfo> =>
  ports
    .slice()
    .sort((a, b) => a - b)
    .map((port) => ({ port, label: labelForPort(port) }))

const uniquePorts = (ports: ReadonlyArray<number>): ReadonlyArray<number> => {
  const result: Array<number> = []
  for (const port of ports) {
    if (!result.includes(port)) {
      result.push(port)
    }
  }
  return result
}

const parseJobs = (raw: string): ReadonlyArray<JobInfo> => {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

  if (lines.length <= 1) {
    return []
  }

  const entries = lines.slice(1)
  const jobs: Array<JobInfo> = []

  for (const line of entries) {
    const tokens = line.trim().split(/\s+/u)
    const pidRaw = tokens.shift()
    const tty = tokens.shift() ?? "?"
    const elapsed = tokens.pop() ?? "-"
    const cmd = tokens.join(" ")
    const pid = pidRaw ? Number(pidRaw) : Number.NaN

    if (Number.isNaN(pid)) {
      continue
    }
    if (cmd.startsWith("sshd") || cmd.startsWith("ps -eo")) {
      continue
    }
    jobs.push({ pid, tty, cmd, elapsed })
  }

  return jobs
}

const readComposeRows = (projectDir: string) =>
  pipe(
    runDockerComposePsFormatted(projectDir),
    Effect.map(parseComposeRows),
    Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<ComposeRow>))
  )

const readComposeLogs = (projectDir: string) =>
  pipe(
    runCommandCapture(
      {
        cwd: projectDir,
        command: "docker",
        args: ["compose", "logs", "--tail", "120"]
      },
      [0, 1],
      (exitCode) => new CommandFailedError({ command: "docker compose logs", exitCode })
    ),
    Effect.map((raw) =>
      raw
        .split(/\r?\n/u)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
    ),
    Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<string>))
  )

const readJobs = (item: ProjectItem) =>
  pipe(
    runCommandCapture(
      {
        cwd: item.projectDir,
        command: "docker",
        args: ["exec", item.containerName, "ps", "-eo", "pid,tty,cmd,etime", "--sort=start_time"]
      },
      [0],
      (exitCode) => new CommandFailedError({ command: "docker exec ps", exitCode })
    ),
    Effect.map(parseJobs),
    Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<JobInfo>))
  )

const runExecCommand = (item: ProjectItem, command: string) =>
  runCommandCapture(
    {
      cwd: item.projectDir,
      command: "docker",
      args: ["exec", item.containerName, "bash", "-lc", command]
    },
    [0],
    (exitCode) => new CommandFailedError({ command: "docker exec", exitCode })
  )

const resolveProjectItem = (projectId: string) =>
  pipe(
    listProjectItems,
    Effect.flatMap((items) => {
      const matched = items.find((item) => item.projectDir === projectId)
      return matched ? Effect.succeed(matched) : Effect.fail(new CommandFailedError({
        command: "project lookup",
        exitCode: 1
      }))
    })
  )

// CHANGE: list docker-git projects for the web UI
// WHY: web dashboard must reflect live docker-git state
// QUOTE(ТЗ): "Нам надо что бы он работал как наш docker-git CLI"
// REF: user-request-2026-02-03-web-ui
// SOURCE: n/a
// FORMAT THEOREM: forall p: list(p) -> summary(p)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<ProjectSummary>, CommandFailedError, FileSystem | Path | CommandExecutor>
// INVARIANT: order matches docker-git config discovery
// COMPLEXITY: O(n)
export const listProjects = (): Effect.Effect<ReadonlyArray<ProjectSummary>, CommandFailedError> =>
  Effect.gen(function*(_) {
    ensureProjectsRoot()
    const items = yield* _(listProjectItems)
    const summaries: Array<ProjectSummary> = []

    for (const item of items) {
      const rows = yield* _(readComposeRows(item.projectDir))
      const status = statusFromRows(rows)
      const statusLabel = statusLabelFromRows(rows)
      summaries.push({
        id: item.projectDir,
        displayName: item.displayName,
        repoUrl: item.repoUrl,
        repoRef: formatRepoRef(item.repoRef),
        status,
        statusLabel
      })
    }

    return summaries
  })

// CHANGE: load a single project with jobs, ports, and logs
// WHY: render the active project panel from live docker data
// QUOTE(ТЗ): "он работал как наш docker-git CLI"
// REF: user-request-2026-02-03-web-ui
// SOURCE: n/a
// FORMAT THEOREM: forall p: details(p) -> ports(p) & jobs(p)
// PURITY: SHELL
// EFFECT: Effect<ProjectDetails, CommandFailedError, FileSystem | Path | CommandExecutor>
// INVARIANT: id matches docker-git projectDir
// COMPLEXITY: O(1)
export const getProjectDetails = (
  projectId: string
): Effect.Effect<ProjectDetails, CommandFailedError> =>
  Effect.gen(function*(_) {
    ensureProjectsRoot()
    const item = yield* _(resolveProjectItem(projectId))
    const rows = yield* _(readComposeRows(item.projectDir))
    const status = statusFromRows(rows)
    const statusLabel = statusLabelFromRows(rows)
    const ports = buildPorts(uniquePorts(collectPorts(rows).concat(item.sshPort)))
    const ip = yield* _(runDockerInspectContainerIp(item.projectDir, item.containerName).pipe(
      Effect.catchAll(() => Effect.succeed(""))
    ))
    const jobs = status === "running" ? yield* _(readJobs(item)) : []
    const logs = yield* _(readComposeLogs(item.projectDir))
    const ssh = `${item.sshUser}@localhost:${item.sshPort}`

    return {
      id: item.projectDir,
      displayName: item.displayName,
      repoUrl: item.repoUrl,
      repoRef: formatRepoRef(item.repoRef),
      status,
      statusLabel,
      recreateStatus: getRecreateStatus(item.projectDir),
      ssh,
      sshCommand: item.sshCommand,
      projectDir: item.projectDir,
      containerName: item.containerName,
      serviceName: item.serviceName,
      targetDir: item.targetDir,
      ip,
      ports,
      jobs,
      logs
    }
  })

// CHANGE: run a command inside the active container
// WHY: power the web terminal input
// QUOTE(ТЗ): "Нам надо что бы он работал как наш docker-git CLI"
// REF: user-request-2026-02-03-web-ui-exec
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exec(cmd) -> output(cmd)
// PURITY: SHELL
// EFFECT: Effect<string, CommandFailedError, CommandExecutor>
// INVARIANT: command is executed via docker exec bash -lc
// COMPLEXITY: O(command)
export const execProjectCommand = (
  projectId: string,
  command: string
): Effect.Effect<string, CommandFailedError> =>
  Effect.gen(function*(_) {
    ensureProjectsRoot()
    const item = yield* _(resolveProjectItem(projectId))
    return yield* _(runExecCommand(item, command))
  })

export const upProject = (projectId: string): Effect.Effect<void, CommandFailedError> =>
  Effect.gen(function*(_) {
    ensureProjectsRoot()
    const item = yield* _(resolveProjectItem(projectId))
    yield* _(runDockerComposeUp(item.projectDir))
  })

export const downProject = (projectId: string): Effect.Effect<void, CommandFailedError> =>
  Effect.gen(function*(_) {
    ensureProjectsRoot()
    const item = yield* _(resolveProjectItem(projectId))
    yield* _(runDockerComposeDown(item.projectDir))
  })

// CHANGE: launch a background recreate using the same flow as CLI clone --force
// WHY: keep web behavior identical to docker-git CLI without long-running HTTP calls
// QUOTE(ТЗ): "использовать то что мы уже использовали для CLI 1 в 1"
// REF: user-request-2026-02-04-force-clone-web
// SOURCE: n/a
// FORMAT THEOREM: forall p: start(p) -> running(p)
// PURITY: SHELL
// EFFECT: Effect<RecreateStatus, CommandFailedError, CommandExecutor>
// INVARIANT: background recreate writes status updates
// COMPLEXITY: O(1) + background(command)
export const startRecreateProject = (projectId: string) =>
  Effect.gen(function*(_) {
    ensureProjectsRoot()
    const item = yield* _(resolveProjectItem(projectId))
    const current = getRecreateStatus(item.projectDir)
    if (current.phase === "running") {
      return current
    }
    return markRecreateStatus(item.projectDir, "running", "Recreate started")
  })
