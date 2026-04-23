import type { AgentSession, ContainerTask, ContainerTaskKind } from "../api/contracts.js"

export type RawContainerProcess = {
  readonly pid: number
  readonly ppid: number
  readonly user: string
  readonly tty: string
  readonly etime: string
  readonly etimes: number
  readonly command: string
  readonly baseline: boolean
  readonly logAvailable: boolean
}

export type ManagedAgentPid = {
  readonly agentId: string
  readonly pid: number
}

const interactiveAgentPattern = /\b(codex|claude|opencode|gemini)\b/u

const hasInteractiveTty = (process: RawContainerProcess): boolean =>
  process.tty !== "?" && process.tty.trim().length > 0

const commandSuggestsSsh = (command: string): boolean => command.startsWith("sshd:") || command.includes(" sshd:")

const commandSuggestsAgent = (command: string): boolean =>
  interactiveAgentPattern.test(command) || command.includes("docker-git-agent-")

const resolveAncestorManagedId = (
  process: RawContainerProcess,
  pidToProcess: ReadonlyMap<number, RawContainerProcess>,
  managedPidToAgentId: ReadonlyMap<number, string>
): string | undefined => {
  let cursor: RawContainerProcess | undefined = process
  const seen = new Set<number>()
  while (cursor !== undefined && !seen.has(cursor.pid)) {
    seen.add(cursor.pid)
    const managedId = managedPidToAgentId.get(cursor.pid)
    if (managedId !== undefined) {
      return managedId
    }
    cursor = pidToProcess.get(cursor.ppid)
  }
  return undefined
}

const classifyProcess = (
  process: RawContainerProcess,
  managedId: string | undefined
): ContainerTaskKind => {
  if (managedId !== undefined || commandSuggestsAgent(process.command)) {
    return "agent"
  }
  if (process.baseline) {
    return "system"
  }
  if (commandSuggestsSsh(process.command) || hasInteractiveTty(process)) {
    return "ssh"
  }
  return "background"
}

const compareTasks = (left: ContainerTask, right: ContainerTask): number => {
  const byKind = left.kind.localeCompare(right.kind)
  if (byKind !== 0) {
    return byKind
  }
  const byRuntime = right.etimes - left.etimes
  return byRuntime !== 0 ? byRuntime : left.pid - right.pid
}

// CHANGE: classify raw container processes into stable task-manager rows.
// WHY: API, CLI and WEB must share one total model for terminal/task visibility.
// QUOTE(ТЗ): "можем мы сделать возможность видеть все запщуенные терминалы в контейнере?"
// REF: user-message-2026-04-22-container-task-manager
// SOURCE: n/a
// FORMAT THEOREM: forall p in Processes: classify(p) in ContainerTaskKind
// PURITY: CORE
// EFFECT: none
// INVARIANT: includeDefault=false excludes only baseline system processes
// COMPLEXITY: O(n * h) where h is maximum process ancestry depth
export const buildContainerTasks = (
  processes: ReadonlyArray<RawContainerProcess>,
  managedAgentPids: ReadonlyArray<ManagedAgentPid>,
  includeDefault: boolean
): ReadonlyArray<ContainerTask> => {
  const pidToProcess = new Map(processes.map((process) => [process.pid, process]))
  const managedPidToAgentId = new Map(managedAgentPids.map((entry) => [entry.pid, entry.agentId]))

  return processes
    .map((process) => {
      const managedId = resolveAncestorManagedId(process, pidToProcess, managedPidToAgentId)
      const kind = classifyProcess(process, managedId)
      return {
        pid: process.pid,
        ppid: process.ppid,
        user: process.user,
        tty: process.tty,
        etime: process.etime,
        etimes: process.etimes,
        command: process.command,
        kind,
        ...(managedId === undefined ? {} : { managedId }),
        logAvailable: process.logAvailable
      } satisfies ContainerTask
    })
    .filter((task) => includeDefault || task.kind !== "system")
    .sort(compareTasks)
}

export const activeAgents = (agents: ReadonlyArray<AgentSession>): ReadonlyArray<AgentSession> =>
  agents.filter((agent) => !["stopped", "exited", "failed"].includes(agent.status))
