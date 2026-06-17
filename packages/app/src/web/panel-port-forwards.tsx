import type { JSX } from "react"

import { Box, Text, TextInput } from "../ui/primitives.js"
import { type ProjectDetails, type ProjectPortForward, projectPortForwardProxyUrl, type ProjectSummary } from "./api.js"

type PortForwardPanelProps = {
  readonly input: string
  readonly onCloseForward: (targetPort: number) => void
  readonly onInputChange: (value: string) => void
  readonly onOpenForward: () => void
  readonly onRefreshForwards: () => void
  readonly project: ProjectDetails | null
  readonly selectedProjectSummary: ProjectSummary | undefined
  readonly forwards: ReadonlyArray<ProjectPortForward>
}

const statusColor = (status: ProjectPortForward["status"]): string => {
  if (status === "running") {
    return "#56f39a"
  }
  if (status === "stopped") {
    return "#ffb86c"
  }
  return "#ffd166"
}

const openUrl = (url: string): void => {
  if (typeof open === "function") {
    globalThis.open(url, "_blank", "noopener")
  }
}

const ForwardRow = (
  {
    forward,
    onClose
  }: {
    readonly forward: ProjectPortForward
    readonly onClose: (targetPort: number) => void
  }
): JSX.Element => {
  const proxyUrl = projectPortForwardProxyUrl(forward)
  return (
    <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} padding={1}>
      <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
        <Text bold={true} fg="#d6e5f7">container:{forward.targetPort} {"->"} host:{forward.hostPort}</Text>
        <Text fg={statusColor(forward.status)}>{forward.status}</Text>
      </Box>
      <Box
        onClick={() => {
          openUrl(proxyUrl)
        }}
      >
        <Text fg="#7fdfff" wrap="truncate">{proxyUrl}</Text>
      </Box>
      <Text fg="#8fa6c4" wrap="truncate">direct: {forward.url}</Text>
      <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
        <Text fg="#8fa6c4" wrap="truncate">via {forward.containerName}</Text>
        <Box
          onClick={() => {
            onClose(forward.targetPort)
          }}
          width="auto"
        >
          <Text bold={true} fg="#ff8aa0">close</Text>
        </Box>
      </Box>
    </Box>
  )
}

const ForwardList = (
  {
    forwards,
    onCloseForward
  }: {
    readonly forwards: ReadonlyArray<ProjectPortForward>
    readonly onCloseForward: (targetPort: number) => void
  }
): JSX.Element => (
  <Box flexDirection="column" gap={1} marginTop={1}>
    {forwards.length === 0
      ? <Text fg="#8fa6c4">No open project ports.</Text>
      : forwards.map((forward) => (
        <ForwardRow
          key={`${forward.targetPort}-${forward.hostPort}`}
          forward={forward}
          onClose={onCloseForward}
        />
      ))}
  </Box>
)

const PortInput = (
  {
    input,
    onInputChange,
    onOpenForward,
    onRefreshForwards
  }: Pick<
    PortForwardPanelProps,
    "input" | "onInputChange" | "onOpenForward" | "onRefreshForwards"
  >
): JSX.Element => (
  <Box flexDirection="column" gap={1} marginTop={1}>
    <Text fg="#d6e5f7">Container port</Text>
    <TextInput
      ariaLabel="Container port"
      onChange={onInputChange}
      onEnter={() => {
        onOpenForward()
      }}
      placeholder="3000"
      value={input}
    />
    <Box flexWrap="wrap" gap={1}>
      <Box onClick={onOpenForward} width="auto">
        <Text bold={true} fg="#78f0a3">open port</Text>
      </Box>
      <Box onClick={onRefreshForwards} width="auto">
        <Text bold={true} fg="#7fdfff">refresh</Text>
      </Box>
    </Box>
  </Box>
)

export const PortForwardPanel = (
  {
    forwards,
    input,
    onCloseForward,
    onInputChange,
    onOpenForward,
    onRefreshForwards,
    project,
    selectedProjectSummary
  }: PortForwardPanelProps
): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">Project ports</Text>
    <Text fg="#d6e5f7" wrap="wrap">
      Open a host URL for a service running inside the selected container.
    </Text>
    <Text fg="#8fa6c4" marginTop={1} wrap="truncate">
      Project: {selectedProjectSummary?.displayName ?? "not selected"}
    </Text>
    <Text fg="#8fa6c4" wrap="truncate">
      Container: {project?.containerName ?? "load project info first"}
    </Text>
    <PortInput
      input={input}
      onInputChange={onInputChange}
      onOpenForward={onOpenForward}
      onRefreshForwards={onRefreshForwards}
    />
    <Text fg="#8fa6c4" marginTop={1} wrap="wrap">
      Localhost-only services are forwarded through the project SSH server. Services that bind 0.0.0.0 also work.
    </Text>
    <ForwardList forwards={forwards} onCloseForward={onCloseForward} />
  </Box>
)
