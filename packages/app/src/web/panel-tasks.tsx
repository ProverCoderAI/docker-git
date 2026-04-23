import type { JSX } from "react"

import { Box, Text } from "../ui/primitives.js"
import type { ContainerTask, ContainerTaskSnapshot, ProjectDetails, ProjectSummary } from "./api.js"

type TaskPanelProps = {
  readonly logs: string
  readonly onLoadLogs: (pid: number) => void
  readonly onRefreshTasks: () => void
  readonly onStopTask: (pid: number) => void
  readonly project: ProjectDetails | null
  readonly selectedProjectSummary: ProjectSummary | undefined
  readonly snapshot: ContainerTaskSnapshot | null
}

const kindColor = (kind: ContainerTask["kind"]): string => {
  if (kind === "agent") {
    return "#c792ea"
  }
  if (kind === "ssh" || kind === "web-terminal") {
    return "#7fdfff"
  }
  if (kind === "system") {
    return "#8fa6c4"
  }
  return "#56f39a"
}

const compactCommand = (command: string): string => command.length <= 120 ? command : `${command.slice(0, 117)}...`

const TaskRow = (
  {
    onLoadLogs,
    onStopTask,
    task
  }: {
    readonly onLoadLogs: (pid: number) => void
    readonly onStopTask: (pid: number) => void
    readonly task: ContainerTask
  }
): JSX.Element => (
  <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} padding={1}>
    <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
      <Box flexWrap="wrap" gap={1}>
        <Text bold={true} fg="#d6e5f7">PID {task.pid}</Text>
        <Text fg="#8fa6c4">PPID {task.ppid}</Text>
        <Text fg={kindColor(task.kind)}>{task.kind}</Text>
        <Text fg="#8fa6c4">{task.tty}</Text>
        <Text fg="#8fa6c4">{task.etime}</Text>
      </Box>
      <Box flexWrap="wrap" gap={1}>
        {task.logAvailable
          ? (
            <Box
              onClick={() => {
                onLoadLogs(task.pid)
              }}
              width="auto"
            >
              <Text bold={true} fg="#7fdfff">logs</Text>
            </Box>
          )
          : <Text fg="#6f7f90">no logs</Text>}
        <Box
          onClick={() => {
            onStopTask(task.pid)
          }}
          width="auto"
        >
          <Text bold={true} fg="#ff8aa0">stop</Text>
        </Box>
      </Box>
    </Box>
    <Text fg="#d6e5f7" wrap="truncate">{compactCommand(task.command)}</Text>
    {task.managedId === undefined
      ? null
      : <Text fg="#8fa6c4" wrap="truncate">managed: {task.managedId}</Text>}
  </Box>
)

const TaskList = (
  {
    onLoadLogs,
    onStopTask,
    tasks
  }: {
    readonly onLoadLogs: (pid: number) => void
    readonly onStopTask: (pid: number) => void
    readonly tasks: ReadonlyArray<ContainerTask>
  }
): JSX.Element => (
  <Box flexDirection="column" gap={1} marginTop={1}>
    {tasks.length === 0
      ? <Text fg="#8fa6c4">No active user tasks.</Text>
      : tasks.map((task) => (
        <TaskRow
          key={task.pid}
          onLoadLogs={onLoadLogs}
          onStopTask={onStopTask}
          task={task}
        />
      ))}
  </Box>
)

const TaskLogs = ({ logs }: Pick<TaskPanelProps, "logs">): JSX.Element | null =>
  logs.trim().length === 0
    ? null
    : (
      <Box border={true} borderColor="#3a4652" flexDirection="column" marginTop={1} padding={1}>
        <Text bold={true} fg="#8be9fd">Task logs</Text>
        <Text fg="#d6e5f7" wrap="wrap">{logs}</Text>
      </Box>
    )

export const TaskPanel = (
  {
    logs,
    onLoadLogs,
    onRefreshTasks,
    onStopTask,
    project,
    selectedProjectSummary,
    snapshot
  }: TaskPanelProps
): JSX.Element => (
  <Box flexDirection="column">
    <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
      <Text bold={true} fg="#8be9fd">Container tasks</Text>
      <Box onClick={onRefreshTasks} width="auto">
        <Text bold={true} fg="#7fdfff">refresh</Text>
      </Box>
    </Box>
    <Text fg="#8fa6c4" marginTop={1} wrap="truncate">
      Project: {selectedProjectSummary?.displayName ?? "not selected"}
    </Text>
    <Text fg="#8fa6c4" wrap="truncate">
      Container: {snapshot?.containerName ?? project?.containerName ?? "load project info first"}
    </Text>
    <Box flexWrap="wrap" gap={1} marginTop={1}>
      <Text fg="#d6e5f7">tasks: {snapshot?.tasks.length ?? 0}</Text>
      <Text fg="#d6e5f7">ssh: {snapshot?.sshConnections ?? 0}</Text>
      <Text fg="#8fa6c4">updated: {snapshot?.generatedAt ?? "never"}</Text>
    </Box>
    <TaskList
      onLoadLogs={onLoadLogs}
      onStopTask={onStopTask}
      tasks={snapshot?.tasks ?? []}
    />
    <TaskLogs logs={logs} />
  </Box>
)
